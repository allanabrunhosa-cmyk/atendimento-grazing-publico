import { describe, expect, it } from 'vitest';
import { dividirLotesImportacao, explicarRecusaImportacao, lerImportacaoConhecimento } from '../../apps/atendimento-chat-consulta/importacao-conhecimento';

describe('importação de fontes no painel', () => {
  it('aceita lista ou objeto com itens, normaliza categoria e descarta campos extras', () => {
    const itens = lerImportacaoConhecimento(JSON.stringify({ itens: [
      { pergunta: ' Aceita Pix? ', resposta: 'Aceitamos Pix fictício.', categoria: 'Política', origem: 'questionário', rascunho: true },
      { pergunta: 'Tem vegetariana?', resposta: 'Há versões fictícias.', categoria: 'produto', condicoes: ' Conferir na loja ' },
      { pergunta: 'Retirada?', resposta: 'Retirada fictícia combinada.' },
    ] }));
    expect(itens).toEqual([
      { pergunta: 'Aceita Pix?', resposta: 'Aceitamos Pix fictício.', categoria: 'politica' },
      { pergunta: 'Tem vegetariana?', resposta: 'Há versões fictícias.', categoria: 'produto', condicoes: 'Conferir na loja' },
      { pergunta: 'Retirada?', resposta: 'Retirada fictícia combinada.', categoria: 'procedimento' },
    ]);
    expect(lerImportacaoConhecimento('[{"pergunta":"A","resposta":"B"}]')).toHaveLength(1);
  });

  it('explica o problema em vez de enviar conteúdo inválido', () => {
    expect(() => lerImportacaoConhecimento('{')).toThrow('não é um JSON válido');
    expect(() => lerImportacaoConhecimento('[]')).toThrow('Nenhuma fonte encontrada');
    expect(() => lerImportacaoConhecimento('[{"pergunta":"A"}]')).toThrow('A fonte 1 precisa de pergunta e resposta');
    expect(() => lerImportacaoConhecimento('[{"pergunta":"A","resposta":"B","categoria":"exceção"}]')).toThrow('categoria desconhecida');
    expect(() => lerImportacaoConhecimento(JSON.stringify(Array.from({ length: 501 }, () => ({ pergunta: 'A', resposta: 'B' }))))).toThrow('no máximo 500');
  });

  it('divide em lotes de até 25 fontes e abaixo do limite de bytes', () => {
    const curtos = Array.from({ length: 60 }, (_, n) => ({ pergunta: 'P' + n, resposta: 'R' + n }));
    expect(dividirLotesImportacao(curtos).map(l => l.length)).toEqual([25, 25, 10]);
    const longos = Array.from({ length: 10 }, () => ({ pergunta: 'Pergunta', resposta: 'ã'.repeat(6000) }));
    const lotes = dividirLotesImportacao(longos);
    expect(lotes.flat()).toHaveLength(10);
    for (const lote of lotes) expect(new TextEncoder().encode(JSON.stringify(lote)).length).toBeLessThan(65536);
  });

  it('traduz os códigos de recusa do servidor', () => {
    expect(explicarRecusaImportacao('CONHECIMENTO_DADOS_PESSOAIS')).toBe('tem telefone, e-mail ou CPF');
    expect(explicarRecusaImportacao('DUVIDAS_ENTRADA_INVALIDA')).toContain('campo');
  });
});
