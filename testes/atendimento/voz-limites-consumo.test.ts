import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { criarVozDireta, FalhaVozDireta } from '../../src/lib/atendimento/operacao-ferramentas';
import { oggFicticio, wavFicticio } from './voz-fixtures';

describe('voz limitada antes do POST e consumo sanitizado, transportes fictícios', () => {
  it('recusa áudio excessivo/sem duração e texto excessivo sem rede nem truncamento', async () => {
    const f = vi.fn<typeof fetch>(), registrar = vi.fn(), voz = criarVozDireta({ chave: 'fixture', vozId: 'fixture', registrarConsumo: registrar }, f);
    await expect(voz.transcrever(wavFicticio(61, 1, 8000), 'audio/wav', new AbortController().signal)).rejects.toThrow('VOZ_DURACAO_EXCEDIDA');
    await expect(voz.transcrever(new Uint8Array([1, 2, 3]), 'audio/ogg', new AbortController().signal)).rejects.toThrow('VOZ_DURACAO_NAO_COMPROVADA');
    await expect(voz.transcrever(wavFicticio(), 'audio/mp4', new AbortController().signal)).rejects.toThrow('VOZ_DURACAO_NAO_COMPROVADA');
    await expect(voz.sintetizar('x'.repeat(1001), new AbortController().signal)).rejects.toThrow('VOZ_TEXTO_INVALIDO');
    expect(f).not.toHaveBeenCalled(); expect(registrar).not.toHaveBeenCalled();
  });
  it('limites privados menores são efetivos e aumento acima da fronteira é recusado', async () => {
    const f = vi.fn<typeof fetch>(), voz = criarVozDireta({ chave: 'fixture', vozId: 'fixture', maxDuracaoSegundos: 1, maxCaracteres: 5 }, f);
    await expect(voz.transcrever(wavFicticio(2), 'audio/wav', new AbortController().signal)).rejects.toThrow('VOZ_DURACAO_EXCEDIDA');
    await expect(voz.sintetizar('123456', new AbortController().signal)).rejects.toThrow('VOZ_TEXTO_INVALIDO');
    expect(() => criarVozDireta({ chave: 'fixture', maxDuracaoSegundos: 61 }, f)).toThrow('VOZ_CONFIGURACAO_INVALIDA');
    expect(() => criarVozDireta({ chave: 'fixture', maxCaracteres: 1001 }, f)).toThrow('VOZ_CONFIGURACAO_INVALIDA'); expect(f).not.toHaveBeenCalled();
  });
  it('WhatsApp Opus permanece suportado e STT não inventa custo observado ausente', async () => {
    const registrar = vi.fn(), f = vi.fn<typeof fetch>(async () => Response.json({ text: 'Pergunta fictícia' }, { headers: { 'request-id': 'stt-fixture' } }));
    const r = await criarVozDireta({ chave: 'fixture', registrarConsumo: registrar }, f).transcrever(oggFicticio(), 'audio/ogg', new AbortController().signal);
    expect(r.consumo).toEqual({ observado: false, duracaoEntradaMs: 120, requisicaoId: 'stt-fixture' });
    expect(registrar).toHaveBeenCalledExactlyOnceWith({ operacao: 'transcricao', provedor: 'elevenlabs', modelo: 'scribe_v1', resultado: 'concluida', consumo: r.consumo }); expect(f).toHaveBeenCalledTimes(1);
  });
  it('TTS conserva texto literal e registra character-cost como unidades do fornecedor, sem converter em dólares', async () => {
    const registrar = vi.fn(), f = vi.fn<typeof fetch>(async (_u, o) => {
      expect(JSON.parse(o!.body as string).text).toBe('Texto fictício');
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'audio/mpeg', 'character-cost': '7.5', 'request-id': 'tts-fixture', 'x-trace-id': 'trace-fixture' } });
    });
    const r = await criarVozDireta({ chave: 'fixture', vozId: 'fixture', registrarConsumo: registrar }, f).sintetizar('Texto fictício', new AbortController().signal);
    expect(r.consumo).toEqual({ observado: true, caracteresEntrada: 14, caracteresCobrados: 7.5, requisicaoId: 'tts-fixture', rastreioId: 'trace-fixture' });
    expect(registrar).toHaveBeenCalledExactlyOnceWith({ operacao: 'sintese', provedor: 'elevenlabs', modelo: 'eleven_turbo_v2_5', resultado: 'concluida', consumo: r.consumo });
  });
  it.each([401, 503])('falha HTTP%s registra resultado seguro e não repete POST', async status => {
    const registrar = vi.fn(), f = vi.fn<typeof fetch>(async () => new Response('fixture segredo texto não permitido', { status, headers: { 'request-id': 'falha-fixture' } }));
    let falha: unknown;
    try { await criarVozDireta({ chave: 'fixture-segredo', registrarConsumo: registrar }, f).transcrever(wavFicticio(), 'audio/wav', new AbortController().signal); } catch (e) { falha = e; }
    expect(falha).toBeInstanceOf(FalhaVozDireta); expect((falha as Error).message).toBe('VOZ_TRANSCRICAO_INDISPONIVEL');
    expect(registrar.mock.calls[0][0]).toMatchObject({ resultado: status === 401 ? 'recusada' : 'incerta', consumo: { observado: false, duracaoEntradaMs: 250, requisicaoId: 'falha-fixture' } }); expect(f).toHaveBeenCalledTimes(1);
  });
  it('resposta perdida e falha de persistência tornam a chamada incerta sem retransmitir', async () => {
    const registrar = vi.fn(), perdido = vi.fn<typeof fetch>(async () => { throw Error('fixture timeout segredo'); });
    await expect(criarVozDireta({ chave: 'fixture', vozId: 'fixture', registrarConsumo: registrar }, perdido).sintetizar('Texto fictício', new AbortController().signal)).rejects.toMatchObject({ resultado: 'incerto' });
    expect(registrar.mock.calls[0][0]).toMatchObject({ resultado: 'incerta' }); expect(perdido).toHaveBeenCalledTimes(1);
    const sucesso = vi.fn<typeof fetch>(async () => Response.json({ text: 'Transcrição fictícia' })), persistir = vi.fn(async () => { throw Error('fixture armazenamento indisponível'); });
    await expect(criarVozDireta({ chave: 'fixture', registrarConsumo: persistir }, sucesso).transcrever(wavFicticio(), 'audio/wav', new AbortController().signal)).rejects.toMatchObject({ resultado: 'incerto' });
    expect(sucesso).toHaveBeenCalledTimes(1); expect(persistir).toHaveBeenCalledTimes(1);
  });
});
