import { afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PoolClient } from 'pg';
import { criarProvedorEvidenciasDireto } from '../../src/lib/atendimento/ia-orquestrador-direto';
import { LIMITE_PROMPT_CENTRAL, validarPromptCentralAgente } from '../../src/lib/atendimento/repositorio-agente-pg';
import { criarExtensaoAgenteOperacional } from '../../src/lib/atendimento/operacao-agente-http';
import { escritaPainelDonatellaPermitida } from '../../src/lib/atendimento/operacao-chat-minimo';
import { ServicoAgenteOperacional, type ConfiguracaoPrivadaAgente } from '../../src/lib/atendimento/operacao-agente';
import type { AcaoOperacao, IdentidadeOperacao } from '../../src/lib/atendimento/operacao-tipos';
import type { RepositorioOperacaoPg } from '../../src/lib/atendimento/operacao-repositorio-pg';

const PROMPT = 'Você é a Donatella da loja de exemplo. Oriente sempre o pedido pelo site.';
const identidade: IdentidadeOperacao = { id: 'ficticio', nome: 'Pessoa Fictícia', perfilId: 'fixture', sessaoVersao: 1, permissoes: [] };
afterEach(() => vi.unstubAllEnvs());

describe('validação do prompt central', () => {
  it('aceita vazio, quebras de linha e o limite; recusa excesso, controle, segredo e campo extra', () => {
    for (const texto of ['', PROMPT, 'Linha 1\nLinha 2\tcom tab', 'x'.repeat(LIMITE_PROMPT_CENTRAL)]) expect(() => validarPromptCentralAgente({ texto })).not.toThrow();
    for (const texto of ['x'.repeat(LIMITE_PROMPT_CENTRAL + 1), 'com \u0007 controle', 'chave sk-ant-exemplo']) expect(() => validarPromptCentralAgente({ texto }), texto.slice(0, 20)).toThrow('AGENTE_PROMPT_INVALIDO');
    expect(() => validarPromptCentralAgente({ texto: PROMPT, extra: 1 } as never)).toThrow('AGENTE_PROMPT_INVALIDO');
  });
  it('recusa telefone, e-mail e CPF, que a Donatella repetiria a clientes', () => {
    for (const texto of ['Fale com contato@exemplo.invalid', 'Ligue (11) 91234-5678', 'CPF 123.456.789-09']) expect(() => validarPromptCentralAgente({ texto }), texto).toThrow('AGENTE_PROMPT_DADOS_PESSOAIS');
    expect(() => validarPromptCentralAgente({ texto: 'Composição para 40 pessoas: 1× Tábua — R$ 480,00. Atendemos das 8 às 18.' })).not.toThrow();
  });
});

describe('prompt central na chamada da IA', () => {
  const pedido = { sistema: 'Base fixa fictícia.', perguntaNaoConfiavel: 'Oi', fontes: [] };
  async function sistema(promptCentral?: string) {
    vi.stubEnv('ATENDIMENTO_IA_HABILITADA', 'true');
    let enviado = '';
    const transporte = vi.fn<typeof fetch>(async (_u, o) => { enviado = JSON.parse(String(o?.body)).system; return Response.json({ content: [{ type: 'text', text: '{"selecoes":[],"pedirApoio":true}' }], stop_reason: 'end_turn' }); });
    await criarProvedorEvidenciasDireto({ chave: 'ficticia', modelo: 'claude-sonnet-4-5-20250929', maxTokens: 512, respostaRedigida: true, ...(promptCentral !== undefined ? { promptCentral } : {}) }, transporte)(pedido, new AbortController().signal);
    return { enviado, transporte };
  }
  it('entra depois da identidade fixa e antes das regras, que prevalecem', async () => {
    const { enviado } = await sistema(`  ${PROMPT}\n`);
    expect(enviado.startsWith('Base fixa fictícia.')).toBe(true);
    expect(enviado).toContain(`<prompt_central>\n${PROMPT}\n</prompt_central>`);
    expect(enviado.indexOf('</prompt_central>')).toBeLessThan(enviado.indexOf('Responda somente JSON'));
    expect(enviado).toContain('As regras depois dele prevalecem em caso de conflito');
    expect(enviado).toContain('Todo fato da resposta deve estar nas fontes selecionadas');
  });
  it('vazio não entra na chamada', async () => {
    for (const p of [undefined, '', '  \n ']) expect((await sistema(p)).enviado).not.toContain('prompt_central');
  });
  it('acima do limite não chega a chamar a IA', async () => {
    vi.stubEnv('ATENDIMENTO_IA_HABILITADA', 'true');
    const transporte = vi.fn<typeof fetch>();
    await expect(criarProvedorEvidenciasDireto({ chave: 'ficticia', modelo: 'claude-sonnet-4-5-20250929', maxTokens: 512, respostaRedigida: true, promptCentral: 'x'.repeat(8001) }, transporte)(pedido, new AbortController().signal)).rejects.toThrow('IA_PROMPT_CENTRAL_INVALIDO');
    expect(transporte).not.toHaveBeenCalled();
  });
});

describe('rotas do prompt central', () => {
  const promptCentral = vi.fn(async () => ({ texto: '', versao: 0 })), configurarPromptCentral = vi.fn(async () => ({ versao: 1 }));
  const extensao = criarExtensaoAgenteOperacional({ duvidas: () => ({}), promptCentral, configurarPromptCentral } as unknown as ServicoAgenteOperacional, 'grazing');
  const resposta = () => ({ writeHead: vi.fn(), end: vi.fn() }) as unknown as ServerResponse;
  const pedido = (path: string, method = 'POST') => ({ url: '/api/atendimento/operacao' + path, method }) as IncomingMessage;
  it('lê por GET e grava só texto, versão e idempotência', async () => {
    await extensao(pedido('/agente/prompt', 'GET'), resposta(), identidade);
    expect(promptCentral).toHaveBeenCalledWith(identidade);
    const corpo = { texto: PROMPT, versao: 0, idempotencia: 'fixture' };
    await extensao(pedido('/agente/prompt/configurar'), resposta(), identidade, corpo);
    expect(configurarPromptCentral).toHaveBeenCalledExactlyOnceWith(identidade, corpo);
    await expect(extensao(pedido('/agente/prompt/configurar'), resposta(), identidade, { ...corpo, chave: 'agente' })).rejects.toThrow('OPERACAO_ENTRADA_INVALIDA');
    const get = resposta(); await extensao(pedido('/agente/prompt/configurar', 'GET'), get, identidade);
    expect(get.writeHead).toHaveBeenCalledWith(405, expect.any(Object));
    expect(configurarPromptCentral).toHaveBeenCalledOnce();
    expect(escritaPainelDonatellaPermitida('/agente/prompt/configurar', {})).toBe(true);
  });
});

describe('gravação do prompt central', () => {
  function servico(permitidas: AcaoOperacao[], versaoPrompt = 0) {
    const consultas: { sql: string; params?: unknown[] }[] = [], auditar = vi.fn(async () => undefined);
    const tx = { query: vi.fn(async (sql: string, params?: unknown[]) => {
      consultas.push({ sql, params });
      if (sql.includes("chave='agente' FOR UPDATE")) return { rows: [{ versao: '7' }], rowCount: 1 };
      if (sql.includes("chave='agente_prompt' FOR UPDATE")) return { rows: versaoPrompt ? [{ versao: String(versaoPrompt) }] : [], rowCount: versaoPrompt ? 1 : 0 };
      if (sql.includes("VALUES('agente_prompt'")) return { rows: [{ versao: String(versaoPrompt + 1) }], rowCount: 1 };
      if (sql.includes("SET versao=versao+1,atualizada_em=now() WHERE chave='agente' RETURNING")) return { rows: [{ versao: '8' }], rowCount: 1 };
      if (sql.includes("WHERE chave='agente_prompt'")) return { rows: versaoPrompt ? [{ conteudo: { texto: PROMPT }, versao: String(versaoPrompt) }] : [], rowCount: versaoPrompt ? 1 : 0 };
      return { rows: [], rowCount: 0 };
    }) } as unknown as PoolClient;
    const operacao = {
      pool: {}, transacao: async <T>(f: (t: PoolClient) => Promise<T>) => f(tx), auditar,
      exigir: vi.fn(async (_tx: PoolClient, _i: IdentidadeOperacao, acao: AcaoOperacao) => { if (!permitidas.includes(acao)) throw Error('OPERACAO_ACESSO_NEGADO'); }),
      comando: async <T>(_tx: PoolClient, _i: IdentidadeOperacao, _id: string, _c: unknown, executar: () => Promise<T>) => executar(),
    } as unknown as RepositorioOperacaoPg;
    const privada = { empresaId: 'grazing', anthropic: { chave: '', modelo: 'claude-sonnet-4-5-20250929', maxTokens: 512 }, custoVozCentavos: 0, orcamentoMaximoCentavosDia: 0, autoridadeAutomatica: false } as ConfiguracaoPrivadaAgente;
    return { agente: new ServicoAgenteOperacional({ operacao, configuracao: privada, carregarMidia: async () => null }), consultas, auditar };
  }
  it('lê com ia.visualizar; sem nada salvo, vem vazio na versão 0', async () => {
    expect(await servico(['ia.visualizar']).agente.promptCentral(identidade)).toEqual({ texto: '', versao: 0 });
    expect(await servico(['ia.visualizar'], 3).agente.promptCentral(identidade)).toEqual({ texto: PROMPT, versao: 3 });
    await expect(servico([]).agente.promptCentral(identidade)).rejects.toThrow('OPERACAO_ACESSO_NEGADO');
  });
  it('grava sem espaços nas pontas, cria versão, audita e descarta respostas pendentes', async () => {
    const s = servico(['ia.editar'], 2);
    expect(await s.agente.configurarPromptCentral(identidade, { texto: `  ${PROMPT}  `, versao: 2, idempotencia: 'fixture' })).toMatchObject({ versao: 3, versaoAgente: 8 });
    expect(s.consultas.find(c => c.sql.includes("VALUES('agente_prompt'"))?.params).toEqual([JSON.stringify({ texto: PROMPT })]);
    expect(s.consultas.some(c => c.sql.includes('AGENTE_CONFIGURACAO_ALTERADA'))).toBe(true);
    expect(s.auditar).toHaveBeenCalledWith(expect.anything(), identidade, 'agente_prompt', 'configurar_agente_prompt', 3);
  });
  it('recusa versão antiga, permissão faltando e dado pessoal sem gravar', async () => {
    const antiga = servico(['ia.editar'], 2);
    await expect(antiga.agente.configurarPromptCentral(identidade, { texto: PROMPT, versao: 1, idempotencia: 'fixture' })).rejects.toThrow('OPERACAO_CONFLITO');
    const sem = servico(['ia.visualizar']);
    await expect(sem.agente.configurarPromptCentral(identidade, { texto: PROMPT, versao: 0, idempotencia: 'fixture' })).rejects.toThrow('OPERACAO_ACESSO_NEGADO');
    const pessoal = servico(['ia.editar']);
    await expect(pessoal.agente.configurarPromptCentral(identidade, { texto: 'Ligue (11) 91234-5678', versao: 0, idempotencia: 'fixture' })).rejects.toThrow('AGENTE_PROMPT_DADOS_PESSOAIS');
    for (const s of [antiga, sem, pessoal]) expect(s.consultas.some(c => c.sql.includes("VALUES('agente_prompt'"))).toBe(false);
  });
});
