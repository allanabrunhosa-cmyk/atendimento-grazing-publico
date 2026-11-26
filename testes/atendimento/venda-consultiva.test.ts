import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { consultaHubComercial, escolherProdutosHub, quantidadeComercial } from '../../src/lib/atendimento/operacao-comercial';
import { SKILLS_AGENTE_PADRAO, skillPermiteAgente, temaComContexto, temaPergunta, validarSkillsAgente } from '../../src/lib/atendimento/repositorio-agente-pg';
import { SKILL_CONSULTORA_VENDAS } from '../../src/lib/atendimento/skill-consultora-vendas';
import { orquestrarIA, type ContextoIA, type FonteIA, type PortasIA, type TarefaIA } from '../../src/lib/atendimento/ia-orquestrador';
import type { ProdutoHubLeitura } from '../../src/lib/atendimento/operacao-hub-produtos';

const hub = (id: string, nome: string, especificacao: string): ProdutoHubLeitura => ({ id, nome, especificacao, sku: null, versao: '1', wooProdutoId: null, wooVariacaoId: null, consultadoEm: '2026-11-23T12:00:00.000Z' });
const catalogo = [
  hub('p2', 'Tábua Exemplo para 2', 'Serve 2 pessoas. Queijos e frutas de exemplo.'),
  hub('p4', 'Tábua Exemplo para 4', 'Serve 4 pessoas. Queijos, embutidos e frutas de exemplo.'),
  hub('p4v', 'Tábua Exemplo Vegetariana para 4', 'Serve 4 pessoas. Versão vegetariana de exemplo.'),
  hub('p10', 'Mesa Exemplo para 10', 'Serve 10 pessoas. Mesa para festas e aniversários de exemplo.'),
];

describe('qualificação: a conversa de compra chega ao catálogo', () => {
  it('intenção de comprar não é consulta a pedido existente', () => {
    for (const p of ['Quero fazer um pedido', 'Quero fazer meu pedido', 'Quero encomendar uma tábua', 'Gostaria de fazer uma encomenda']) expect(temaPergunta(p), p).toBe('produto');
    for (const p of ['Como faço um pedido?', 'Quero encomendar, como funciona?']) expect(temaPergunta(p), p).toBe('procedimento');
    for (const p of ['Qual o status do pedido?', 'Já fiz meu pedido, cadê?']) expect(temaPergunta(p), p).toBe('pedido');
  });

  it('ocasião, número de pessoas e preferência vão para o catálogo', () => {
    for (const p of ['É para um aniversário', 'Somos 10', 'Prefiro vegetariana', 'Vai ser um chá de bebê']) expect(temaPergunta(p), p).toBe('produto');
  });

  it('resposta curta durante conversa de produto continua no catálogo; pergunta nova não', () => {
    expect(temaComContexto('A segunda', 'produto')).toBe('produto');
    expect(temaComContexto('Pode ser à tarde', 'preco')).toBe('produto');
    expect(temaComContexto('Qual a diferença delas?', 'produto')).toBe('produto');
    expect(temaComContexto('Aceita Pix?', 'produto')).toBe('procedimento');
    expect(temaComContexto('Obrigada!', 'produto')).toBe('procedimento');
    expect(temaComContexto('A segunda', 'procedimento')).toBe('procedimento');
    expect(temaComContexto('A segunda', null)).toBe('procedimento');
    expect(temaComContexto('Entregam em Osasco?', 'produto')).toBe('frete');
  });
});

describe('catálogo: ocasião ordena e nunca elimina as opções', () => {
  it('a consulta ao HUB leva quantidade e produto, sem a ocasião', () => {
    expect(consultaHubComercial('É para um aniversário de 10 pessoas')).toBe('10 dez');
    expect(consultaHubComercial('Quero algo para uma festa')).toBe('');
    expect(consultaHubComercial('Tábua vegetariana para um aniversário')).toBe('tabua vegetariana');
  });

  it('"somos 10" conta como número de pessoas', () => {
    expect(quantidadeComercial('Somos 10')).toBe(10);
    expect(quantidadeComercial('Vamos ser em oito, somos em oito')).toBe(8);
    expect(quantidadeComercial('Somos uma empresa')).toBeNull();
  });

  it('quantidade escolhe pela capacidade; ocasião sozinha ainda traz opções', () => {
    expect(escolherProdutosHub('É para um aniversário, somos 10 pessoas', catalogo).map(p => p.id)).toEqual(['p10']);
    expect(escolherProdutosHub('É para um aniversário', catalogo)[0].id).toBe('p10');
    expect(escolherProdutosHub('É para um aniversário', catalogo)).toHaveLength(3);
    expect(escolherProdutosHub('tábua vegetariana para 4 pessoas', catalogo)[0].id).toBe('p4v');
  });
});

describe('habilidade Consultora de vendas', () => {
  it('vem nas habilidades padrão, é válida e libera conhecimento junto do catálogo', () => {
    expect(SKILLS_AGENTE_PADRAO.skills.some(s => s.id === SKILL_CONSULTORA_VENDAS.id)).toBe(true);
    expect(() => validarSkillsAgente(SKILLS_AGENTE_PADRAO)).not.toThrow();
    expect(SKILL_CONSULTORA_VENDAS.finalidade.length).toBeLessThanOrEqual(1000);
    expect(skillPermiteAgente(SKILLS_AGENTE_PADRAO, 'produto', 'consultar_conhecimento')).toBe(true);
    expect(skillPermiteAgente({ skills: SKILLS_AGENTE_PADRAO.skills.filter(s => s.id !== 'vendas') }, 'produto', 'consultar_conhecimento')).toBe(false);
  });
});

describe('orquestrador: produto lê catálogo e conhecimento numa chamada só', () => {
  it('conhecimento estático entra; o que cita preço fica de fora; uma reserva para a leitura', async () => {
    const t: TarefaIA = { id: 'tarefa-venda', atorId: 'service:donatella-ia', empresaId: 'grazing', conversaId: 'conversa-venda', clienteId: 'cliente-venda', versao: 1, mensagemOrigemId: 'mensagem-venda', pergunta: 'Quero mandar uma tábua de presente', tema: 'produto' };
    const fonte = (id: string, origem: FonteIA['origem'], conteudo: string): FonteIA => ({ id, versao: 1, empresaId: 'grazing', clienteId: t.clienteId, tema: 'produto', origem, estado: 'aprovado', inicio: 0, fim: Date.now() + 60000, conteudo });
    const catalogoFonte = fonte('hub-presente', 'ferramenta', 'Produto do HUB: Caixa Presente Exemplo. Serve duas pessoas.');
    const cartao = fonte('conhecimento-cartao', 'conhecimento', 'Você pode incluir um cartão com mensagem personalizada.');
    const preco = fonte('conhecimento-preco', 'conhecimento', 'A caixa custa R$ 100 no site.');
    const contexto: ContextoIA = { ...t, estado: 'ia', modo: 'rascunho' };
    let chamadas = 0, recebidas: string[] = [];
    const portas: PortasIA = {
      respostaRedigida: true, agora: () => Date.now(), autorizar: async () => true,
      conhecimento: async () => [cartao, preco], ferramenta: async () => [catalogoFonte],
      revalidarFontes: async () => true, solicitarApoio: async () => ({ id: 'apoio' }),
      repositorio: { contexto: async () => contexto, reservar: async () => ({ lease: 'lease' }), reservarChamada: async () => { chamadas++; return true; }, preservarApoio: async (_t, _l, d) => d, concluir: async (_t, _l, d) => d },
      provedor: async pedido => { recebidas = pedido.fontes.map(f => f.id); return { selecoes: [{ id: 'hub-presente', versao: 1 }, { id: 'conhecimento-cartao', versao: 1 }], pedirApoio: false, texto: 'A Caixa Presente Exemplo serve duas pessoas, e você pode incluir um cartão com mensagem personalizada.' }; },
    };
    const r = await orquestrarIA(t, { maxChamadas: 2, custoPorChamadaCentavos: 50, maxCustoCentavos: 100, maxDuracaoMs: 5000, timeoutChamadaMs: 1500 }, portas);
    expect(r).toMatchObject({ estado: 'rascunho', enviosReais: false });
    expect(recebidas).toEqual(['hub-presente', 'conhecimento-cartao']);
    expect(chamadas).toBe(2);
  });
});
