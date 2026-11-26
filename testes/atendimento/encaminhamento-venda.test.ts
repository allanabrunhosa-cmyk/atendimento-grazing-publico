import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { estadoVenda, motivoVendaEquipe, pedidoOrcamento } from '../../src/lib/atendimento/encaminhamento-venda';
import { incluirLinksCompra, validarTextoRedigidoIA } from '../../src/lib/atendimento/ia-resposta-fundamentada';
import { escolherProdutosHub, fonteSiteOficial, fontesProdutosComerciais, termosComerciais } from '../../src/lib/atendimento/operacao-comercial';
import { classificarNaConversa, temaComContexto, temaPergunta } from '../../src/lib/atendimento/repositorio-agente-pg';
import { SKILL_CONSULTORA_VENDAS } from '../../src/lib/atendimento/skill-consultora-vendas';
import { orquestrarIA, type ContextoIA, type FonteIA, type PortasIA, type TarefaIA } from '../../src/lib/atendimento/ia-orquestrador';
import type { ProdutoComercial } from '../../src/lib/atendimento/comercial-tipos';

const SITE = 'https://loja-exemplo.invalid';
const tarefa: TarefaIA = { id: 'tarefa-site', atorId: 'service:donatella-ia', empresaId: 'grazing', conversaId: 'conversa-site', clienteId: 'cliente-site', versao: 1, mensagemOrigemId: 'mensagem-site', pergunta: 'Quero uma tábua para 4 pessoas', tema: 'produto' };
const produto = (id: string, nome: string, slug: string | null): ProdutoComercial => ({ hubId: id, nome, especificacao: 'Serve 4 pessoas. Queijos e frutas de exemplo.', motivo: 'Exemplo', fonteHub: { id, versao: '1', consultadoEm: '2026-11-24T12:00:00.000Z' }, vinculo: { estado: slug ? 'confirmado' : 'pendente', motivo: slug ? null : 'Não há anúncio com identidade compatível.' }, oferta: slug ? { produtoId: 1, variacaoId: null, sku: 'DEMO', url: `${SITE}/produto/${slug}`, imagemUrl: null, tipo: 'simples', preco: { moeda: 'BRL', valor: '289.90', tipo: 'fixo' }, compravel: true, disponibilidade: 'instock', consultadoEm: '2026-11-24T12:00:00.000Z' } : null } as ProdutoComercial);
const classica = produto('p4', 'Tábua Exemplo para 4', 'tabua-exemplo-4'), vegetariana = produto('p4v', 'Tábua Exemplo Vegetariana para 4', 'tabua-exemplo-vegetariana-4');

describe('quem vai para a equipe numa venda', () => {
  it('cliente que não consegue pedir pelo site', () => {
    for (const p of ['Não consigo finalizar no site', 'Não estou conseguindo fazer o pedido', 'não consegui pagar', 'Tentei várias vezes e não vai', 'O site não abre', 'O link não funciona', 'Deu erro no pagamento', 'Meu cartão foi recusado', 'O pix não foi gerado', 'Não sei mexer no site', 'Não consegui', 'Não deu certo', 'O site não aceita meu CEP', 'Minha mãe não consegue comprar no site']) {
      expect(motivoVendaEquipe(p), p).toBe('DIFICULDADE_NO_SITE'); expect(temaPergunta(p), p).toBe('excecao');
    }
  });
  it('pedido corporativo', () => {
    for (const p of ['Quero um pedido corporativo', 'É para um evento da empresa', 'Confraternização da firma', 'Vocês atendem empresas?', 'É para a minha empresa', 'Da empresa', 'Quero presentear meus clientes', 'Quero mandar presentes para os funcionários', 'Coffee break para 30 pessoas', 'Preciso de nota no CNPJ', 'Happy hour do escritório', 'Pedido pela empresa']) {
      expect(motivoVendaEquipe(p), p).toBe('PEDIDO_CORPORATIVO'); expect(temaPergunta(p), p).toBe('excecao');
    }
  });
  it('o resto continua com a Donatella, inclusive preferir o WhatsApp e entregar no trabalho de alguém', () => {
    for (const p of ['Quero uma tábua para 4', 'Prefiro fazer por aqui mesmo', 'Posso pedir pelo WhatsApp?', 'Como faço um pedido?', 'Vocês entregam na minha empresa?', 'Quero mandar uma tábua para a empresa do meu marido', 'Pode entregar no meu escritório?', 'Qual o nome da empresa?', 'Qual o CNPJ de vocês?', 'Vocês emitem nota fiscal?', 'Não é para empresa', 'Não consigo escolher', 'Vocês não conseguem fazer para hoje?', 'Vocês não aceitam pix?', 'Quero incluir um cartão com mensagem', 'Não consigo encontrar opção vegetariana no site', 'Sem problema, pode ser pelo site', 'Não tem problema, compro no site', 'Confraternização com amigos', 'Festa com o pessoal da família']) expect(motivoVendaEquipe(p), p).toBeNull();
  });
  it('com a venda na equipe, o que o cliente manda depois não volta ao catálogo', () => {
    const equipe = estadoVenda(['Evento da empresa']);
    expect(equipe).toEqual({ motivo: 'PEDIDO_CORPORATIVO', aguardandoOrcamento: false });
    expect(classificarNaConversa('São 80 pessoas, dia 10', 'excecao', equipe)).toEqual({ tema: 'excecao', motivoEquipe: 'PEDIDO_CORPORATIVO' });
    for (const p of ['Era a tábua para 4', 'Meu nome é Ana', 'Boa tarde, seria para o dia 12 de manhã', 'E o orçamento?']) expect(temaComContexto(p, 'excecao', equipe), p).toBe('excecao');
    expect(temaComContexto('Vocês entregam em Osasco?', 'excecao', equipe)).toBe('frete');
    expect(temaComContexto('Obrigada', 'excecao', equipe)).toBe('procedimento');
    expect(classificarNaConversa('Tenho alergia a nozes', 'excecao', equipe)).toEqual({ tema: 'alergia' });
    expect(classificarNaConversa('Quero reembolso', 'excecao', equipe)).toEqual({ tema: 'excecao' });
    expect(temaComContexto('São 80 pessoas, dia 10', 'excecao')).toBe('produto');
  });
});

describe('orçamento', () => {
  it('pedido de orçamento recebe a lista de dados; limite de gasto é preferência', () => {
    for (const p of ['Quero um orçamento', 'Vocês fazem orçamento?', 'Quero um orçamento para 20 pessoas', 'Orçamento de tábua para aniversário', 'Preciso de uma cotação', 'Queria um orçamento com entrega em Moema', 'Pode cotar uma mesa?']) {
      expect(pedidoOrcamento(p), p).toBe(true); expect(temaPergunta(p), p).toBe('procedimento'); expect(temaComContexto(p, 'produto'), p).toBe('procedimento');
    }
    for (const p of ['Meu orçamento é de 300 reais', 'Tenho um orçamento de R$ 500', 'Algo dentro do orçamento de 400 reais', 'Orçamento até 300', 'Quanto custa a tábua para 4?']) expect(pedidoOrcamento(p), p).toBe(false);
    expect(temaPergunta('Quero um orçamento para evento da empresa')).toBe('excecao');
  });
  it('os dados que o cliente manda depois vão para a equipe, com o motivo', () => {
    const espera = estadoVenda(['Oi', 'Quero um orçamento']);
    expect(espera).toEqual({ motivo: null, aguardandoOrcamento: true });
    for (const p of ['Ana Exemplo, tábua para 10, dia 12 às 19h, Moema, aniversário', 'Ana Exemplo', 'Boa tarde! Ana Exemplo, mesa para 10, sábado às 19h']) expect(classificarNaConversa(p, 'procedimento', espera), p).toEqual({ tema: 'excecao', motivoEquipe: 'ORCAMENTO' });
    const enviado = estadoVenda(['Quero um orçamento', 'Ana Exemplo, tábua para 10']);
    expect(enviado.motivo).toBe('ORCAMENTO');
    expect(classificarNaConversa('É em Moema', 'excecao', enviado)).toEqual({ tema: 'excecao', motivoEquipe: 'ORCAMENTO' });
  });
  it('pergunta, despedida e quem vai pelo site seguem a venda normal', () => {
    const espera = estadoVenda(['Quero um orçamento']);
    expect(temaComContexto('Quanto custa a tábua para 4?', 'procedimento', espera)).toBe('preco');
    expect(temaComContexto('Ok, obrigada', 'procedimento', espera)).toBe('procedimento');
    expect(temaComContexto('Então vou pedir pelo site', 'procedimento', espera)).not.toBe('excecao');
    expect(temaComContexto('Quero um orçamento', 'procedimento', espera)).toBe('procedimento');
    expect(estadoVenda(['Quero um orçamento', 'Não consigo finalizar no site']).motivo).toBe('DIFICULDADE_NO_SITE');
  });
});

describe('o pedido é sempre pelo site', () => {
  it('a habilidade orienta o site e limita o apoio humano aos dois casos', () => {
    expect(SKILL_CONSULTORA_VENDAS.finalidade.length).toBeLessThanOrEqual(1000);
    expect(SKILL_CONSULTORA_VENDAS.finalidade).toMatch(/Oriente a pedir pelo site/);
    expect(SKILL_CONSULTORA_VENDAS.finalidade).toMatch(/Sugira produtos já na primeira resposta.*quantidade, nome exato e preço/);
    expect(SKILL_CONSULTORA_VENDAS.finalidade).toMatch(/não conseguir pedir pelo site ou se o pedido for corporativo/);
    expect(SKILL_CONSULTORA_VENDAS.finalidade).not.toMatch(/nome completo/);
  });
  it('pedir por aqui no meio da venda volta ao catálogo, para reforçar o link', () => {
    for (const p of ['Pode fechar pra mim?', 'Posso pedir por aqui?', 'Dá para comprar pelo WhatsApp?', 'Prefiro fazer por aqui mesmo', 'Como compro?']) expect(temaComContexto(p, 'produto'), p).toBe('produto');
    expect(temaComContexto('Aceita Pix?', 'produto')).toBe('procedimento');
  });
  it('saudação e caminho da compra não eliminam o catálogo', () => {
    for (const p of ['Oi, quero fazer um pedido', 'Olá, boa tarde! Queria encomendar', 'Me manda o link', 'Quais os preços?', 'Prefiro fazer por aqui mesmo']) expect(termosComerciais(p), p).toEqual([]);
    expect(termosComerciais('Boa tarde, vocês têm chá da tarde?')).toContain('tarde');
    const hub = [{ id: 'p4', nome: classica.nome, especificacao: classica.especificacao, sku: null, versao: '1', wooProdutoId: null, wooVariacaoId: null, consultadoEm: '' }];
    expect(escolherProdutosHub('Oi, quero fazer um pedido', hub)).toHaveLength(1);
    expect(escolherProdutosHub('Quero comprar sushi', hub)).toHaveLength(0);
  });
  it('o produto traz o link estruturado só com anúncio conferido, e o site oficial vem da loja configurada', () => {
    const [com, sem] = fontesProdutosComerciais(tarefa, [classica, produto('p9', 'Tábua sem anúncio', null)], 0);
    expect(com.compra).toEqual({ nome: classica.nome, url: `${SITE}/produto/tabua-exemplo-4`, preco: 'R$ 289,90' });
    expect(com.conteudo).toContain('O cliente faz o pedido no site, por esse link.');
    expect(sem.compra).toBeUndefined();
    expect(fonteSiteOficial(tarefa, SITE + '/', 0)).toMatchObject({ id: 'site_oficial', origem: 'ferramenta', conteudo: expect.stringContaining(`Site oficial: ${SITE}.`) });
  });
});

describe('links na resposta', () => {
  const fontes = fontesProdutosComerciais(tarefa, [classica, vegetariana], 0);
  it('inclui o link do produto citado quando o modelo esquece, sem repetir o que já veio', () => {
    const so = incluirLinksCompra('A Tábua Exemplo para 4 serve 4 pessoas e custa R$ 289,90.', fontes);
    expect(so).toBe(`A Tábua Exemplo para 4 serve 4 pessoas e custa R$ 289,90.\n\nPara pedir pelo site:\nTábua Exemplo para 4: ${SITE}/produto/tabua-exemplo-4`);
    expect(validarTextoRedigidoIA(so, fontes)).toBe(true);
    expect(incluirLinksCompra(so, fontes)).toBe(so);
    const comLink = `Sugiro a Tábua Exemplo para 4: ${SITE}/produto/tabua-exemplo-4.`;
    expect(incluirLinksCompra(comLink, fontes)).toBe(comLink);
    expect(incluirLinksCompra('Qual é a ocasião?', fontes)).toBe('Qual é a ocasião?');
  });
  it('sem espaço, mantém o texto', () => {
    const longo = 'Tábua Exemplo para 4 ' + 'a'.repeat(1970);
    expect(incluirLinksCompra(longo, fontes)).toBe(longo);
  });
  it('link com pontuação passa; pedaço de link e endereço novo não', () => {
    for (const t of [`Peça aqui: ${SITE}/produto/tabua-exemplo-4!`, `Veja *${SITE}/produto/tabua-exemplo-4*`, `${SITE}/produto/tabua-exemplo-4/`]) expect(validarTextoRedigidoIA(t, fontes), t).toBe(true);
    for (const t of [`${SITE}/produto/tabua-exemplo`, `${SITE}/produto/outra-tabua`, 'www.outra-loja.invalid']) expect(validarTextoRedigidoIA(t, fontes), t).toBe(false);
  });
});

describe('orquestrador', () => {
  const ensaio = async (t: TarefaIA, texto = 'Sugiro a Tábua Exemplo para 4.') => {
    const contexto: ContextoIA = { ...t, estado: 'ia', modo: 'rascunho' }, provedor = vi.fn(async (pedido: { fontes: FonteIA[] }) => ({ selecoes: [{ id: pedido.fontes[0].id, versao: pedido.fontes[0].versao }], pedirApoio: false, texto }));
    const fontes = fontesProdutosComerciais(t, [classica], Date.now()), motivos: string[] = [];
    const portas: PortasIA = {
      respostaRedigida: true, autorizar: async () => true, conhecimento: async () => [], ferramenta: async () => fontes, revalidarFontes: async () => true, provedor,
      solicitarApoio: async (_t, motivo) => { motivos.push(motivo); return { id: 'apoio' }; },
      repositorio: { contexto: async () => contexto, reservar: async () => ({ lease: 'lease' }), reservarChamada: async () => true, preservarApoio: async (_t, _l, d) => d, concluir: async (_t, _l, d) => d },
    };
    const r = await orquestrarIA(t, { maxChamadas: 2, custoPorChamadaCentavos: 50, maxCustoCentavos: 100, maxDuracaoMs: 5000, timeoutChamadaMs: 1500 }, portas);
    return { r, motivos, provedor };
  };
  it('resposta com produto sai com o link', async () => {
    const { r } = await ensaio(tarefa);
    expect(r).toMatchObject({ estado: 'rascunho', texto: expect.stringContaining(`${SITE}/produto/tabua-exemplo-4`) });
  });
  it('corporativo e dificuldade no site chamam a equipe com o motivo, sem gastar com o modelo', async () => {
    for (const [pergunta, motivo] of [['Evento corporativo para 80 pessoas', 'PEDIDO_CORPORATIVO'], ['Não consigo finalizar no site', 'DIFICULDADE_NO_SITE']] as const) {
      const { r, motivos, provedor } = await ensaio({ ...tarefa, pergunta, tema: temaPergunta(pergunta) });
      expect(r).toMatchObject({ estado: 'aguardando_apoio', motivo }); expect(motivos).toEqual([motivo]); expect(provedor).not.toHaveBeenCalled();
    }
  });
  it('dados do orçamento chegam à equipe com o motivo; o motivo gravado não vale fora de excecao', async () => {
    const dados = await ensaio({ ...tarefa, pergunta: 'Ana Exemplo, tábua para 10, Moema', tema: 'excecao', motivoEquipe: 'ORCAMENTO' });
    expect(dados.r).toMatchObject({ estado: 'aguardando_apoio', motivo: 'ORCAMENTO' }); expect(dados.provedor).not.toHaveBeenCalled();
    expect((await ensaio({ ...tarefa, motivoEquipe: 'ORCAMENTO' })).r).toMatchObject({ estado: 'rascunho' });
    expect((await ensaio({ ...tarefa, pergunta: 'Quero um estorno', tema: 'excecao', motivoEquipe: 'ORCAMENTO' })).r).toMatchObject({ motivo: 'REVISAO_HUMANA_OBRIGATORIA' });
  });
  it('alergia continua como revisão obrigatória, mesmo em pedido corporativo', async () => {
    const pergunta = 'Evento da empresa, temos uma pessoa com alergia a nozes';
    expect((await ensaio({ ...tarefa, pergunta, tema: temaPergunta(pergunta) })).r).toMatchObject({ motivo: 'REVISAO_HUMANA_OBRIGATORIA' });
  });
});
