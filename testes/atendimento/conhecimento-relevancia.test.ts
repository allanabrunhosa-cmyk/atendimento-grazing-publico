import { describe, expect, it } from 'vitest';
import { FONTES_PARA_MODELO, ordenarPorRelevancia, pontuarConhecimento, selecionarFontesParaModelo, termosConhecimento } from '../../src/lib/atendimento/conhecimento-relevancia';

describe('relevância do conhecimento', () => {
  it('ignora acentos, palavras vazias e aproxima flexões comuns', () => {
    expect(termosConhecimento('Vocês entregam em Osasco?')).toEqual(['entre', 'osasc']);
    expect(termosConhecimento('Entrega em Osasco')).toEqual(['entre', 'osasc']);
    expect(termosConhecimento('Tábuas e TABUA')).toEqual(['tabua']);
    expect(termosConhecimento('oi, bom dia! tudo bem?')).toEqual([]);
  });

  it('termo na pergunta da fonte pesa mais que termo só na resposta', () => {
    const pergunta = 'Como conservar a tábua?';
    expect(pontuarConhecimento(pergunta, { pergunta: 'Conservação da tábua', conteudo: 'Mantenha refrigerada.' })).toBe(6);
    expect(pontuarConhecimento(pergunta, { pergunta: 'Validade', conteudo: 'Conserve a tábua na geladeira.' })).toBe(2);
    expect(pontuarConhecimento('Olá!', { pergunta: 'Conservação', conteudo: 'Mantenha refrigerada.' })).toBe(0);
  });

  it('ordena pela pontuação, mantém empates na ordem e respeita o limite', () => {
    const fontes = [
      { id: 'a', pergunta: 'Horário', conteudo: 'Atendemos em horário comercial fictício.' },
      { id: 'b', pergunta: 'Pagamento', conteudo: 'Aceitamos Pix e cartão fictícios.' },
      { id: 'c', pergunta: 'Parcelamento no cartão', conteudo: 'Parcelamos no cartão.' },
      { id: 'd', pergunta: 'Retirada', conteudo: 'Retirada fictícia.' },
    ];
    expect(ordenarPorRelevancia('Parcelam no cartão?', fontes, 10, () => false).map(f => f.id)).toEqual(['c', 'b', 'a', 'd']);
    expect(ordenarPorRelevancia('Parcelam no cartão?', fontes, 10, f => f.id === 'd').map(f => f.id)).toEqual(['c', 'b', 'd', 'a']);
    expect(ordenarPorRelevancia('Parcelam no cartão?', fontes, 1, () => true).map(f => f.id)).toEqual(['c']);
  });

  it('pergunta sem palavra em comum ainda leva a fonte certa ao modelo', () => {
    const fontes = [
      { id: 'pagamento', pergunta: 'Quais são as formas de pagamento?', conteudo: 'Cartão e Pix fictícios.' },
      { id: 'antecedencia', pergunta: 'Com quanta antecedência preciso encomendar?', conteudo: 'Poucas horas de antecedência, num exemplo fictício.' },
    ];
    expect(pontuarConhecimento('Consigo para sexta?', fontes[1])).toBe(0);
    expect(ordenarPorRelevancia('Consigo para sexta?', fontes, 10, () => false).map(f => f.id)).toEqual(['pagamento', 'antecedencia']);
  });

  it('o teto é de caracteres: pula fonte longa demais e para antes de estourar', () => {
    const f = (id: string, tamanho: number) => ({ id, conteudo: 'x'.repeat(tamanho) });
    const teto = { maximo: 3, caracteres: 100, porFonte: 60 };
    expect(selecionarFontesParaModelo([f('a', 30), f('longa', 61), f('b', 40), f('c', 40)], teto).map(v => v.id)).toEqual(['a', 'b']);
    expect(selecionarFontesParaModelo([f('a', 10), f('b', 10), f('c', 10), f('d', 10)], teto).map(v => v.id)).toEqual(['a', 'b', 'c']);
    expect(FONTES_PARA_MODELO.maximo * FONTES_PARA_MODELO.porFonte).toBeGreaterThan(FONTES_PARA_MODELO.caracteres);
    expect(FONTES_PARA_MODELO.caracteres).toBeLessThan(10 * 4000);
  });
});
