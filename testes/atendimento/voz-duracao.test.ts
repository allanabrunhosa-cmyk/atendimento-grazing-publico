import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { conferirDuracaoAudioVoz } from '../../src/lib/atendimento/voz-duracao';
import { atualizarCrcOggFicticio, oggFicticio, paginaOggFicticia, wavFicticio } from './voz-fixtures';

describe('limite comprovado no servidor, somente mídia fictícia', () => {
  it('mede WAV PCM16 pelo número de amostras, inclusive estéreo sem multiplicar a duração', () => {
    expect(conferirDuracaoAudioVoz(wavFicticio(1.25), 'audio/wav')).toEqual({ duracaoMs: 1250, canais: 1, formato: 'wav-pcm' });
    expect(conferirDuracaoAudioVoz(wavFicticio(1.25, 2), 'audio/wav')).toEqual({ duracaoMs: 1250, canais: 2, formato: 'wav-pcm' });
  });
  it('mede os quadros Opus efetivos e inclui pre-skip na medida conservadora', () => {
    expect(conferirDuracaoAudioVoz(oggFicticio(), 'audio/ogg')).toEqual({ duracaoMs: 120, canais: 1, formato: 'ogg-opus' });
    expect(conferirDuracaoAudioVoz(oggFicticio(3000), 'audio/ogg').duracaoMs).toBe(60000);
  });
  it('recusa mais de60 segundos e respeita limites configurados menores', () => {
    expect(() => conferirDuracaoAudioVoz(wavFicticio(60.01, 1, 8000), 'audio/wav')).toThrow('VOZ_DURACAO_EXCEDIDA');
    expect(() => conferirDuracaoAudioVoz(oggFicticio(3001), 'audio/ogg')).toThrow('VOZ_DURACAO_EXCEDIDA');
    expect(() => conferirDuracaoAudioVoz(wavFicticio(2), 'audio/wav', 1)).toThrow('VOZ_DURACAO_EXCEDIDA');
    expect(() => conferirDuracaoAudioVoz(wavFicticio(), 'audio/wav', 61)).toThrow('VOZ_DURACAO_NAO_COMPROVADA');
  });
  it.each(['audio/mpeg', 'audio/mp4', 'audio/webm', 'text/html'])('recusa %s sem alegar duração pelo tamanho', mime => {
    expect(() => conferirDuracaoAudioVoz(wavFicticio(), mime)).toThrow('VOZ_DURACAO_NAO_COMPROVADA');
  });
  it('recusa PCM truncado, tamanho/byte-rate falso e compressão não suportada', () => {
    const a = wavFicticio(); a.writeUInt32LE(a.length - 1, 4);
    const b = wavFicticio(); b.writeUInt32LE(64000, 28);
    const c = wavFicticio(); c.writeUInt16LE(7, 20);
    const d = wavFicticio(); d.writeUInt32LE(9999999, 40);
    for (const v of [a, b, c, d, wavFicticio().subarray(0, 30), wavFicticio(0.05)]) expect(() => conferirDuracaoAudioVoz(v, 'audio/wav')).toThrow('VOZ_DURACAO_NAO_COMPROVADA');
  });
  it('recusa corrupção CRC, páginas ausentes, multiplexação, EOS ausente ou stream encadeada', () => {
    const original = oggFicticio(), headSize = 47, tagsSize = 44, inicioAudio = headSize + tagsSize;
    const crc = Buffer.from(original); crc[crc.length - 1] ^= 1;
    const seq = Buffer.from(original); seq.writeUInt32LE(9, inicioAudio + 18); atualizarCrcOggFicticio(seq.subarray(inicioAudio));
    const serie = Buffer.from(original); serie.writeUInt32LE(80, inicioAudio + 14); atualizarCrcOggFicticio(serie.subarray(inicioAudio));
    const eos = Buffer.from(original); eos[inicioAudio + 5] = 0; atualizarCrcOggFicticio(eos.subarray(inicioAudio));
    for (const v of [crc, seq, serie, eos, Buffer.concat([original, original])]) expect(() => conferirDuracaoAudioVoz(v, 'audio/ogg')).toThrow('VOZ_DURACAO_NAO_COMPROVADA');
  });
  it('não confia no granule falso para diminuir a duração cobrável dos quadros', () => {
    const b = oggFicticio(60), inicioAudio = 91;
    b.writeBigUInt64LE(BigInt(500), inicioAudio + 6); atualizarCrcOggFicticio(b.subarray(inicioAudio));
    // EOS pode aparar o som, mas todo o conteúdo enviado permanece contabilizado.
    expect(conferirDuracaoAudioVoz(b, 'audio/ogg').duracaoMs).toBe(1200);
    expect(() => conferirDuracaoAudioVoz(b, 'audio/ogg', 1)).toThrow('VOZ_DURACAO_EXCEDIDA');
  });
  it('recusa empacotamento Opus que declara contagem/duração inválida', () => {
    const base = oggFicticio().subarray(0, 91);
    for (const p of [Buffer.from([0xfb, 0]), Buffer.from([0xfb, 49]), Buffer.from([0xfb, 7]), Buffer.from([0xf9, 1])]) {
      const b = Buffer.concat([base, paginaOggFicticia([p], 2, 4, 1000)]);
      expect(() => conferirDuracaoAudioVoz(b, 'audio/ogg')).toThrow('VOZ_DURACAO_NAO_COMPROVADA');
    }
  });
});
