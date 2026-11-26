import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { escolherCatalogo, escolherProdutosHub, fonteSiteOficial, fontesProdutosComerciais, podeSugerirProdutos, termosComerciais } from '../../src/lib/atendimento/operacao-comercial';
import { ajustarQuantidades, completarSugestoes, fontesDosEnderecos, incluirLinksCompra, validarTextoRedigidoIA } from '../../src/lib/atendimento/ia-resposta-fundamentada';
import { orquestrarIA, type ContextoIA, type PortasIA, type TarefaIA } from '../../src/lib/atendimento/ia-orquestrador';
import type { ProdutoHubLeitura } from '../../src/lib/atendimento/operacao-hub-produtos';
import type { ProdutoComercial } from '../../src/lib/atendimento/comercial-tipos';

const SITE = 'https://loja-exemplo.invalid', tarefa: TarefaIA = { id: 't', atorId: 'a', empresaId: 'grazing', conversaId: 'c', clienteId: 'x', versao: 1, mensagemOrigemId: 'm', pergunta: 'Festa para 30 pessoas', tema: 'produto' };
const produto = (id: string, nome: string, valor: string, quantidade = 0): ProdutoComercial => ({ hubId: id, nome, especificacao: 'Descrição de exemplo.', motivo: '', fonteHub: { id, versao: '1', consultadoEm: '' }, vinculo: { estado: 'confirmado', motivo: null }, oferta: { produtoId: 1, variacaoId: null, sku: '', url: `${SITE}/produto/${id}`, imagemUrl: null, tipo: 'simples', preco: { moeda: 'BRL', valor, tipo: 'fixo' }, compravel: true, disponibilidade: 'instock', consultadoEm: '' }, ...(quantidade ? { grupo: { tipo: 'composicao' as const, pessoas: 40, quantidade } } : {}) } as ProdutoComercial);
const composicao = fontesProdutosComerciais(tarefa, [produto('modelo', 'Grazing para 10 Modelo (tábua de frios)', '480.00', 1), produto('sanduiche', 'Sanduiches de exemplo – 20 un', '210.00', 1), produto('bolos', 'Mini Bolos Exemplo 24un', '130.00', 2)], Date.now(), true);
const site = fonteSiteOficial(tarefa, SITE, Date.now());
const opcoes4 = fontesProdutosComerciais(tarefa, [produto('g4', 'Grazing para 4', '399.00'), produto('g4v', 'Grazing para 4 Vegetariana', '399.00')], Date.now(), true);
const hub = (id: string, nome: string, especificacao = 'Descrição de exemplo.'): ProdutoHubLeitura => ({ id, nome, especificacao, sku: null, versao: '1', wooProdutoId: null, wooVariacaoId: null, consultadoEm: '' });

describe('termo do cliente é palavra inteira', () => {
  it('"vi no instagram" não vira sauvignon; plural e gênero continuam valendo', async () => {
    const catalogo = [hub('vin', 'Carmen Exemplo Sauvignon Blanc (375ml)'), hub('p10', 'Grazing para 10 Modelo (tábua de frios)'), hub('tor', 'Torta de Abóbora'), hub('veg', 'Grazing para 4 Vegetariana')];
    expect(termosComerciais('Gostei muito dos produtos que vi no instagram')).not.toContain('vi');
    expect((await escolherCatalogo('Eu vou fazer uma festa para o meu aniversário e vai ter uns 30 convidados. Gostei muito dos produtos de vocês que vi no instagram. O que você me sugere de produtos', async () => catalogo, async () => ['Sugestão para 40 pessoas: 1× Grazing para 10 Modelo; 1× Torta de Abóbora.'])).map(v => v.produto.id)).toEqual(['p10', 'tor']);
    expect(escolherProdutosHub('Quero tortas', catalogo).map(p => p.id)).toEqual(['tor']);
    expect(escolherProdutosHub('Prefiro vegetariano', catalogo).map(p => p.id)).toEqual(['veg']);
  });
  it('sugestão automática só com quantidade ou produto pedido pelo nome', () => {
    expect(podeSugerirProdutos('Festa para 30 pessoas', [])).toBe(true);
    expect(podeSugerirProdutos('Quero sauvignon', [{ nome: 'Exemplo Sauvignon Blanc' }])).toBe(true);
    for (const p of ['Quero uma tábua', 'É para um aniversário', 'Vi no instagram e adorei']) expect(podeSugerirProdutos(p, [{ nome: 'Grazing para 4 (tábua de frios)' }]), p).toBe(false);
  });
});

describe('produto vai com preço e link', () => {
  it('na lista, o link entra embaixo de cada linha e o preço só se faltar', () => {
    const r = incluirLinksCompra('Para 30 pessoas, uma composição de 40:\n\n• 1× Grazing para 10 Modelo\n• 1× Sanduíches de exemplo (20 un) — R$ 210,00\n• 2× Mini Bolos Exemplo 24un — R$ 130', composicao);
    expect(r).toBe(`Para 30 pessoas, uma composição de 40:\n\n• 1× Grazing para 10 Modelo — R$ 480,00\n${SITE}/produto/modelo\n• 1× Sanduíches de exemplo (20 un) — R$ 210,00\n${SITE}/produto/sanduiche\n• 2× Mini Bolos Exemplo 24un — R$ 130\n${SITE}/produto/bolos`);
    expect(validarTextoRedigidoIA(r, composicao, new Set(['30']))).toBe(true);
    expect(incluirLinksCompra(r, composicao)).toBe(r);
  });
  it('fora de lista, entra ao fim', () => {
    expect(incluirLinksCompra('Sugiro a Grazing para 4 Vegetariana.', [opcoes4[1]])).toBe(`Sugiro a Grazing para 4 Vegetariana.\n\nPara pedir pelo site:\nGrazing para 4 Vegetariana — R$ 399,00: ${SITE}/produto/g4v`);
  });
  it('resposta sem nenhum produto recebe as opções, uma vez por conversa', () => {
    const texto = 'Que legal! Prefere algo mais descontraído?';
    expect(completarSugestoes(texto, composicao, '')).toHaveLength(3);
    const r = incluirLinksCompra(texto, [], completarSugestoes(texto, composicao, ''));
    expect(r).toBe(`${texto}\n\nUma composição de referência para 40 pessoas, que dá para ajustar:\n• 1× Grazing para 10 Modelo — R$ 480,00\n${SITE}/produto/modelo\n• 1× Sanduiches de exemplo – 20 un — R$ 210,00\n${SITE}/produto/sanduiche\n• 2× Mini Bolos Exemplo 24un — R$ 130,00\n${SITE}/produto/bolos`);
    expect(validarTextoRedigidoIA(r, composicao)).toBe(true);
    expect(incluirLinksCompra(texto, [], completarSugestoes(texto, opcoes4, ''))).toContain('Algumas opções para você ver no site:\n• Grazing para 4 — R$ 399,00');
    expect(completarSugestoes('Quer incluir doces?', composicao, r)).toEqual([]);
    expect(completarSugestoes('Sugiro a Grazing para 10 Modelo.', composicao, '')).toEqual([]);
    expect(completarSugestoes(texto, fontesProdutosComerciais(tarefa, [produto('x', 'Grazing para 4', '1.00')], 0), '')).toEqual([]);
  });
});

describe('quantidade da composição e endereço do site', () => {
  it('item da composição fica com a quantidade da referência', () => {
    const texto = 'Para 30 pessoas, que tal 3 tábuas?\n• 3× Grazing para 10 Modelo — R$ 480,00 cada\n• 2x Sanduiches de exemplo – 20 un\n1× Mini Bolos Exemplo 24un\n• 4× Produto fora das fontes';
    expect(ajustarQuantidades(texto, composicao)).toBe('Para 30 pessoas, que tal 3 tábuas?\n• 1× Grazing para 10 Modelo — R$ 480,00 cada\n• 1× Sanduiches de exemplo – 20 un\n2× Mini Bolos Exemplo 24un\n• 4× Produto fora das fontes');
    expect(ajustarQuantidades('• 2× Grazing para 4', opcoes4)).toBe('• 2× Grazing para 4');
  });
  it('site citado com ou sem www vale pela fonte do site; outro endereço não', () => {
    expect(fontesDosEnderecos('Faça o pedido em www.loja-exemplo.invalid.', [composicao[0], site])).toEqual([site]);
    expect(validarTextoRedigidoIA('Faça o pedido em www.loja-exemplo.invalid.', [site])).toBe(true);
    expect(validarTextoRedigidoIA(`Veja em ${SITE}/`, [site])).toBe(true);
    expect(fontesDosEnderecos('Peça em www.outra-loja.invalid', [site])).toEqual([]);
    expect(validarTextoRedigidoIA('Peça em www.outra-loja.invalid', [site])).toBe(false);
  });
});

describe('orquestrador', () => {
  const ensaio = async (texto: string, ia = '') => {
    const contexto: ContextoIA = { ...tarefa, estado: 'ia', modo: 'rascunho' }, conhecimento = { id: 'conhecimento', versao: 1, empresaId: 'grazing', clienteId: 'x', tema: 'produto' as const, origem: 'conhecimento' as const, estado: 'aprovado' as const, inicio: 0, fim: Date.now() + 60000, conteudo: 'Montamos composições com tábuas, sanduíches, tortas e doces.' };
    const portas: PortasIA = { respostaRedigida: true, autorizar: async () => true, conhecimento: async () => [conhecimento], ferramenta: async () => [...composicao, site], revalidarFontes: async () => true, solicitarApoio: async () => ({ id: 'apoio' }), contextoRecente: async () => [...(ia ? [{ autor: 'ia' as const, texto: ia }] : []), { autor: 'cliente' as const, texto: tarefa.pergunta }],
      provedor: async () => ({ selecoes: [{ id: 'conhecimento', versao: 1 }], pedirApoio: false, texto }),
      repositorio: { contexto: async () => contexto, reservar: async () => ({ lease: 'l' }), reservarChamada: async () => true, preservarApoio: async (_t, _l, d) => d, concluir: async (_t, _l, d) => d } };
    return orquestrarIA(tarefa, { maxChamadas: 2, custoPorChamadaCentavos: 50, maxCustoCentavos: 100, maxDuracaoMs: 5000, timeoutChamadaMs: 1500 }, portas);
  };
  it('modelo que citou os produtos só pelo conhecimento: preço, link e fonte entram', async () => {
    const r = await ensaio('Para 30 pessoas:\n• 1× Grazing para 10 Modelo\n• 2× Mini Bolos Exemplo 24un');
    expect(r).toMatchObject({ estado: 'rascunho', texto: expect.stringContaining(`• 1× Grazing para 10 Modelo — R$ 480,00\n${SITE}/produto/modelo`) });
    expect((r as { fontes: { id: string }[] }).fontes.map(f => f.id)).toEqual(['conhecimento', composicao[0].id, composicao[2].id]);
  });
  it('modelo que só conversou: a composição vai junto na primeira vez e não se repete', async () => {
    const primeira = await ensaio('Que legal, Momento Grazing! Prefere algo descontraído?') as { texto: string; fontes: unknown[] };
    expect(primeira.texto).toContain('Uma composição de referência para 40 pessoas'); expect(primeira.fontes).toHaveLength(4);
    expect((await ensaio('Perfeito! Quer incluir doces?', primeira.texto) as { texto: string }).texto).toBe('Perfeito! Quer incluir doces?');
  });
  it('quantidade recalculada pela IA volta à da referência em vez de chamar a equipe', async () => {
    expect(await ensaio('Para 30 pessoas:\n• 3× Grazing para 10 Modelo — R$ 480,00 cada')).toMatchObject({ estado: 'rascunho', texto: `Para 30 pessoas:\n• 1× Grazing para 10 Modelo — R$ 480,00 cada\n${SITE}/produto/modelo` });
  });
  it('site citado sem a fonte indicada entra como prova', async () => {
    const r = await ensaio('Perfeito! É só pedir em www.loja-exemplo.invalid, pelos links que te mandei.', 'lista já enviada: ' + composicao.map(f => f.compra!.url).join(' '));
    expect(r).toMatchObject({ estado: 'rascunho', texto: 'Perfeito! É só pedir em www.loja-exemplo.invalid, pelos links que te mandei.' });
    expect((r as { fontes: { id: string }[] }).fontes.map(f => f.id)).toEqual(['conhecimento', site.id]);
  });
});
