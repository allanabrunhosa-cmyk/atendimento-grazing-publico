/** Apenas arquivos fictícios curtos: PCM silencioso e pacotes Opus de silêncio.
 * Não contém gravação humana, conta, credencial ou chamada ao fornecedor. */
export function wavFicticio(segundos = 0.25, canais: 1 | 2 = 1, hz = 16000): Buffer {
  const tamanho = Math.round(segundos * hz) * canais * 2, b = Buffer.alloc(44 + tamanho);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20); b.writeUInt16LE(canais, 22); b.writeUInt32LE(hz, 24); b.writeUInt32LE(hz * canais * 2, 28);
  b.writeUInt16LE(canais * 2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(tamanho, 40);
  return b;
}
export function atualizarCrcOggFicticio(b: Buffer): Buffer {
  b.writeUInt32LE(0, 22); let crc = 0;
  for (const byte of b) {
    crc ^= byte << 24;
    for (let i = 0; i < 8; i++) crc = crc & 0x80000000 ? (crc << 1) ^ 0x04c11db7 : crc << 1;
  }
  b.writeUInt32LE(crc >>> 0, 22); return b;
}
export function paginaOggFicticia(pacotes: Buffer[], sequencia: number, flags: number, gp: number): Buffer {
  const lacing = pacotes.flatMap(p => [...Array(Math.floor(p.length / 255)).fill(255), p.length % 255]);
  if (lacing.length > 255) throw Error('FIXTURE_PAGINA_EXCESSIVA');
  const b = Buffer.alloc(27 + lacing.length + pacotes.reduce((n, p) => n + p.length, 0));
  b.write('OggS'); b[5] = flags; b.writeBigUInt64LE(BigInt(gp), 6); b.writeUInt32LE(719, 14); b.writeUInt32LE(sequencia, 18);
  b[26] = lacing.length; Buffer.from(lacing).copy(b, 27); let pos = 27 + lacing.length;
  for (const p of pacotes) { p.copy(b, pos); pos += p.length; }
  return atualizarCrcOggFicticio(b);
}
export function oggFicticio(quadros = 6): Buffer {
  const head = Buffer.alloc(19), tags = Buffer.alloc(16);
  head.write('OpusHead'); head[8] = 1; head[9] = 1; head.writeUInt16LE(312, 10); head.writeUInt32LE(48000, 12); tags.write('OpusTags');
  const paginas = [paginaOggFicticia([head], 0, 2, 0), paginaOggFicticia([tags], 1, 0, 0)];
  for (let n = 0; n < quadros;) {
    const quantidade = Math.min(200, quadros - n); n += quantidade;
    paginas.push(paginaOggFicticia(Array.from({ length: quantidade }, () => Buffer.from([0xf8, 0xff, 0xfe])), paginas.length, n === quadros ? 4 : 0, n * 960));
  }
  return Buffer.concat(paginas);
}
