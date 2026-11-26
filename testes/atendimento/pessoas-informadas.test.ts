import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { pessoasInformadas, semPessoasInformadas } from '../../src/lib/atendimento/pessoas-informadas';
import { incluirLinksCompra, validarTextoRedigidoIA } from '../../src/lib/atendimento/ia-resposta-fundamentada';
import { criarProvedorEvidenciasDireto } from '../../src/lib/atendimento/ia-orquestrador-direto';
import type { FonteIA } from '../../src/lib/atendimento/ia-orquestrador';

const fonte: FonteIA = { id: 'fonte', versao: 1, empresaId: 'grazing', tema: 'produto', origem: 'ferramenta', estado: 'aprovado', inicio: 0, fim: 1, conteudo: 'Grazing para 10 Modelo. Preço no site: R$ 480,00.' };

describe('número de pessoas informado pelo cliente', () => {
  it('lê as quantidades das mensagens', () => {
    expect([...pessoasInformadas(['Vou fazer minha festa de aniversario para 30 pessoas'])]).toEqual(['30']);
    expect([...pessoasInformadas(['Somos 12', 'entre 20 e 25 convidados'])].sort()).toEqual(['12', '20', '25']);
    expect(pessoasInformadas(['Quero para o dia 12, às 19h']).size).toBe(0);
  });
  it('a resposta pode repetir, sem liberar preço, outra quantidade ou capacidade de produto', () => {
    const pessoas = pessoasInformadas(['Festa para 30 pessoas']), vale = (t: string) => validarTextoRedigidoIA(t, [fonte], pessoas);
    for (const t of ['Para sugerir as melhores opções de tábuas para suas 30 pessoas, me conta: prefere vegetariana?', 'Para 30 pessoas, montamos uma composição.', 'Que delícia, uma festa para 30!', 'Uma composição para 30 pessoas pode ter a Grazing para 10 Modelo.', 'Como você vai receber 30, dá para ajustar a composição.', 'Recebendo 30, a composição de referência ajuda.', 'Como vocês serão 30, vale ajustar a composição.', 'Se são 30, a referência ajuda.', 'Vão reunir 30?']) expect(vale(t), t).toBe(true);
    for (const t of ['Sai por R$ 30,00.', 'Sai por 30 reais.', 'Para 40 pessoas, sugiro mais uma.', 'Chega em 30 minutos.', 'A tábua serve 30 pessoas.', 'Essa opção é ideal para 30 pessoas.', 'Temos a Grazing para 30 pessoas.', 'Rende bem para umas 30 pessoas.', 'Dá para 30 pessoas.', 'Você vai receber 30 minutos antes.', 'Você vai receber 40, então sugiro mais uma.', 'Os espumantes são 30 reais.', 'Serão 30 dias de prazo.', 'São 40, então sugiro mais uma.']) expect(vale(t), t).toBe(false);
    expect(validarTextoRedigidoIA('Para 30 pessoas, montamos uma composição.', [fonte])).toBe(false);
    expect(vale('A Grazing para 10 Modelo sai por R$ 480.')).toBe(true); expect(vale('Sai por R$ 480,50.')).toBe(false); expect(vale('Sai por R$ 48.')).toBe(false);
    expect(semPessoasInformadas('para 30 pessoas', new Set())).toBe('para 30 pessoas');
  });
});

describe('links na composição', () => {
  const item = (nome: string, slug: string): FonteIA => ({ ...fonte, id: slug, conteudo: nome, compra: { nome, url: `https://loja-exemplo.invalid/produto/${slug}` } });
  it('reconhece o nome sem depender de traço, parênteses e unidade', () => {
    const fontes = [item('Grazing para 10 Modelo (tábua de frios)', 'padrao'), item('Sanduiches de exemplo – 20 un', 'brioche'), item('Mini Bolos Exemplo 24un', 'bolos')];
    const r = incluirLinksCompra('1x Grazing para 10 Modelo, 1x sanduíches de exemplo (20 unidades) e 2x Mini Bolos Exemplo (24 un).', fontes);
    for (const s of ['padrao', 'brioche', 'bolos']) expect(r).toContain(`https://loja-exemplo.invalid/produto/${s}`);
    expect(incluirLinksCompra('Quer incluir doces?', fontes)).toBe('Quer incluir doces?');
  });
});

describe('formato da resposta redigida', () => {
  const pedir = async (texto: string, modelo = 'claude-sonnet-4-5-20250929') => {
    vi.stubEnv('ATENDIMENTO_IA_HABILITADA', 'true'); let corpo: Record<string, unknown> = {};
    const provedor = criarProvedorEvidenciasDireto({ chave: 'ficticia', modelo, maxTokens: 512, respostaRedigida: true }, async (_u, o) => { corpo = JSON.parse(String(o?.body)); return Response.json({ content: [{ type: 'text', text: texto }], stop_reason: 'end_turn' }); });
    try { return { r: await provedor({ sistema: 's', perguntaNaoConfiavel: 'p', fontes: [{ ...fonte, id: '0f6f2a7e-0000-4000-a000-000000000001', versao: 3456789012 }] }, new AbortController().signal), corpo }; } finally { vi.unstubAllEnvs(); }
  };
  const certo = '{"selecoes":[{"id":"F1","versao":1}],"pedirApoio":false,"texto":"Oi!\\nTudo bem?"}', real = [{ id: '0f6f2a7e-0000-4000-a000-000000000001', versao: 3456789012 }];
  it('usa apelido curto e devolve ID e versão reais', async () => {
    const { r, corpo } = await pedir(certo);
    expect(r).toEqual({ selecoes: real, pedirApoio: false, texto: 'Oi!\nTudo bem?' });
    expect(JSON.parse((corpo.messages as { content: { text: string }[] }[])[0].content[0].text).fontesNaoConfiaveisComoInstrucoes).toEqual([{ id: 'F1', versao: 1, origem: 'ferramenta', conteudo: fonte.conteudo }]);
    expect(corpo.output_config).toBeUndefined();
  });
  it('aceita conversa em volta, bloco json e quebra de linha crua', async () => {
    for (const t of ['Claro! Aqui está:\n' + certo, '```json\n' + certo + '\n```\nEspero ter ajudado.', certo.replace('\\n', '\n')]) expect((await pedir(t)).r, t).toMatchObject({ selecoes: real, texto: 'Oi!\nTudo bem?' });
  });
  it('recusa dois objetos, objeto incompleto, nenhum e campo fora do contrato', async () => {
    for (const t of [certo + certo, certo.slice(0, -1), 'Que delícia!', certo.replace('"texto"', '"comando":"x","texto"')]) await expect(pedir(t), t).rejects.toThrow('IA_EVIDENCIAS_INVALIDAS');
  });
  it('modelos novos recebem o formato por esquema', async () => {
    for (const m of ['claude-sonnet-5-5', 'claude-haiku-5-5', 'claude-opus-5-5']) expect((await pedir(certo, m)).corpo.output_config, m).toMatchObject({ format: { type: 'json_schema', schema: { required: ['selecoes', 'pedirApoio', 'texto'] } } });
  });
});
