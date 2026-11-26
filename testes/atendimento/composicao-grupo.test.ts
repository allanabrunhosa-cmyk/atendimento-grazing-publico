import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { composicaoParaGrupo, composicoesAprovadas, consultaTamanhosHub, escolherCatalogo, escolherProdutosHub, fontesProdutosComerciais, produtoPeloNome } from '../../src/lib/atendimento/operacao-comercial';
import type { ProdutoHubLeitura } from '../../src/lib/atendimento/operacao-hub-produtos';
import type { ProdutoComercial } from '../../src/lib/atendimento/comercial-tipos';
import type { TarefaIA } from '../../src/lib/atendimento/ia-orquestrador';

const hub = (id: string, nome: string, especificacao = 'Descrição de exemplo.'): ProdutoHubLeitura => ({ id, nome, especificacao, sku: null, versao: '1', wooProdutoId: null, wooVariacaoId: null, consultadoEm: '2026-11-25T12:00:00.000Z' });
const catalogo = [
  hub('g2', 'Grazing para 2 (tábua de frios)'), hub('g4', 'Grazing para 4 (tábua de frios)'), hub('g4v', 'Grazing para 4 Vegetariana (tábua de frios)'),
  hub('p10', 'Grazing para 10 Modelo (tábua de frios)'), hub('f10', 'Grazing para 10 Brinde (tábua de frios)'), hub('v10', 'Grazing para 10 Verde (tábua de frios)'),
  hub('san', 'Sanduiches de exemplo – 20 un'), hub('fra', 'Torta de Milho Exemplo'), hub('pal', 'Torta de Abóbora'),
  hub('b24', 'Mini Bolos Exemplo 24un', 'Doces para eventos e clientes.'), hub('b6', 'Mini Bolos Exemplo 6un'), hub('vin', 'Vinho Tinto Exemplo (750ml)', 'Encorpado, para brindar com amigos.'),
];
const texto40 = 'Para grupos maiores, montamos composições com tábuas, sanduíches, tortas e doces. Sugestão para 40 pessoas: 1× Grazing para 10 Modelo; 1× Grazing para 10 Brinde; 1× Sanduiches de exemplo - 20 un; 1× Torta de Milho Exemplo; 1× Torta de Abóbora; 2× Mini Bolos Exemplo 24un. Dá para ajustar ao gosto dos convidados.';
const texto20 = 'Para 20 pessoas: 1 x Grazing para 10 Brinde, 1 x Torta de Abóbora e 1 x Mini Bolos Exemplo 24un.';
const escolher = (busca: string, textos: string[] = [texto40]) => escolherCatalogo(busca, async () => catalogo, async () => textos);

describe('composições do conhecimento', () => {
  it('lê quantidade e itens, em lista por ponto e vírgula ou por vírgula', () => {
    expect(composicoesAprovadas([texto40])).toEqual([{ pessoas: 40, itens: [{ quantidade: 1, nome: 'Grazing para 10 Modelo' }, { quantidade: 1, nome: 'Grazing para 10 Brinde' }, { quantidade: 1, nome: 'Sanduiches de exemplo - 20 un' }, { quantidade: 1, nome: 'Torta de Milho Exemplo' }, { quantidade: 1, nome: 'Torta de Abóbora' }, { quantidade: 2, nome: 'Mini Bolos Exemplo 24un' }] }]);
    expect(composicoesAprovadas([texto20])[0]).toMatchObject({ pessoas: 20, itens: [{ nome: 'Grazing para 10 Brinde' }, { nome: 'Torta de Abóbora' }, { nome: 'Mini Bolos Exemplo 24un' }] });
    expect(composicoesAprovadas(['Aceitamos Pix.', 'A tábua para 10 pessoas é linda.'])).toEqual([]);
  });
  it('escolhe a referência que comporta o grupo; acima de todas, a maior', () => {
    const c = composicoesAprovadas([texto40, texto20]);
    expect([15, 20, 30, 40, 80].map(q => composicaoParaGrupo(c, q)?.pessoas)).toEqual([20, 20, 40, 40, 40]);
    expect(composicaoParaGrupo([], 30)).toBeNull();
  });
  it('acha o produto pelo nome apesar de traço e parênteses, sem confundir parecidos', () => {
    expect(produtoPeloNome('Sanduíches de exemplo - 20 un', catalogo)?.id).toBe('san');
    expect(produtoPeloNome('Mini Bolos Exemplo 24un', catalogo)?.id).toBe('b24');
    expect(produtoPeloNome('Grazing para 4', catalogo)?.id).toBe('g4');
    expect(produtoPeloNome('Torta', catalogo)).toBeNull();
    expect(produtoPeloNome('Produto que não existe', catalogo)).toBeNull();
  });
});

describe('catálogo para o grupo', () => {
  it('opção exata continua como antes', async () => {
    expect((await escolher('Tábua vegetariana para 4 pessoas'))[0]).toEqual({ produto: expect.objectContaining({ id: 'g4v' }) });
    expect((await escolher('É aniversário, somos 10')).map(v => v.produto.id).sort()).toEqual(['f10', 'p10', 'v10']);
  });
  it('mensagem de festa para 30 traz a composição, com quantidades', async () => {
    const r = await escolher('Oi, eu vou fazer minha festa de aniversario para 30 pessoas e gostaria de ter alguns apertivos e gostei muito dos produtos de vocês.\n\nMas não sei o que pedir');
    expect(r.map(v => v.produto.id)).toEqual(['p10', 'f10', 'san', 'fra', 'pal', 'b24']);
    expect(r.every(v => v.grupo?.tipo === 'composicao' && v.grupo.pessoas === 40)).toBe(true);
    expect(r.at(-1)?.grupo).toMatchObject({ quantidade: 2 });
  });
  it('sem composição aprovada, ou com item que sumiu do catálogo, vão as maiores opções', async () => {
    expect((await escolher('Festa para 30 pessoas', [])).map(v => v.produto.id).sort()).toEqual(['f10', 'p10', 'v10']);
    expect((await escolher('Festa para 30 pessoas', ['Para 40 pessoas: 1× Item que saiu; 2× Outro que saiu.'])).every(v => v.grupo?.tipo === 'proxima')).toBe(true);
  });
  it('entre dois tamanhos, sugere os vizinhos; produto pedido pelo nome não vira composição', async () => {
    const seis = await escolher('Somos 6');
    expect(seis.map(v => [v.produto.id, v.grupo])).toEqual([['f10', { tipo: 'proxima', unidades: 1, capacidade: 10 }], ['g4', { tipo: 'proxima', unidades: 2, capacidade: 4 }], ['g2', { tipo: 'proxima', unidades: 3, capacidade: 2 }]]);
    expect((await escolher('Quero vinho para 30 pessoas')).map(v => v.produto.id)).toEqual(['vin']);
    expect((await escolher('Quero torta para 30 pessoas')).map(v => v.produto.id).sort()).toEqual(['fra', 'pal']);
  });
  it('quantidade sem opção não traz produto sem capacidade por acaso; termo desconhecido não elimina', () => {
    expect(escolherProdutosHub('Festa para 30 pessoas', catalogo)).toEqual([]);
    expect(escolherProdutosHub('Quero uns petiscos para 10 pessoas', catalogo)).toHaveLength(3);
    expect(escolherProdutosHub('Quero comprar sushi', catalogo)).toEqual([]);
    expect(escolherProdutosHub('Oi, quero fazer um pedido', catalogo).every(p => p.nome.startsWith('Grazing'))).toBe(true);
    expect(escolherProdutosHub('Quero uma tábua para 4', [...catalogo, hub('rol', 'Búfala Rolls 48un (tábua de frios)')]).map(p => p.id).sort()).toEqual(['g4', 'g4v']);
    expect(consultaTamanhosHub(30).split(' ')).toEqual(['40', '50', '60', '25', '20', '15', '12', '10']);
  });
  it('a fonte da composição diz para quantas pessoas é a referência, e o item leva o link', () => {
    const tarefa = { id: 't', atorId: 'a', empresaId: 'grazing', conversaId: 'c', clienteId: 'x', versao: 1, mensagemOrigemId: 'm', pergunta: 'Festa para 30 pessoas', tema: 'produto' } as TarefaIA;
    const produto = { hubId: 'b24', nome: 'Mini Bolos Exemplo 24un', especificacao: 'x'.repeat(2000), motivo: '', fonteHub: { id: 'b24', versao: '1', consultadoEm: '' }, vinculo: { estado: 'confirmado', motivo: null }, oferta: { produtoId: 1, variacaoId: null, sku: '', url: 'https://loja-exemplo.invalid/produto/bolos', imagemUrl: null, tipo: 'simples', preco: { moeda: 'BRL', valor: '130.00', tipo: 'fixo' }, compravel: true, disponibilidade: 'instock', consultadoEm: '' }, grupo: { tipo: 'composicao', pessoas: 40, quantidade: 2 } } as ProdutoComercial;
    const [f] = fontesProdutosComerciais(tarefa, [produto], 0), [semGrupo] = fontesProdutosComerciais(tarefa, [{ ...produto, grupo: undefined }], 0);
    expect(f.conteudo).toContain('composição de referência para 40 pessoas: 2× Mini Bolos Exemplo 24un');
    expect(f.conteudo.length).toBeLessThan(semGrupo.conteudo.length); expect(f.versao).not.toBe(semGrupo.versao);
    expect(f.compra?.url).toContain('/bolos');
  });
});
