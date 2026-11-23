import { describe, expect, it } from 'vitest';
import { ordenarPorRelevancia, pontuarConhecimento, termosConhecimento } from '../../src/lib/atendimento/conhecimento-relevancia';

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
    expect(ordenarPorRelevancia('Parcelam no cartão?', fontes, 10, () => false).map(f => f.id)).toEqual(['c', 'b']);
    expect(ordenarPorRelevancia('Parcelam no cartão?', fontes, 10, f => f.id === 'a').map(f => f.id)).toEqual(['c', 'b', 'a']);
    expect(ordenarPorRelevancia('Parcelam no cartão?', fontes, 1, () => true).map(f => f.id)).toEqual(['c']);
  });
});
