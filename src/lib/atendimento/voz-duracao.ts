import 'server-only';

export type DuracaoAudioVoz = { duracaoMs: number; canais: 1 | 2; formato: 'wav-pcm' | 'ogg-opus' };
export const MAX_DURACAO_VOZ_SEGUNDOS = 60;
export const MAX_CARACTERES_SINTESE_VOZ = 1000;
const MAX_BYTES = 10 * 1024 * 1024;
function recusado(): never { throw Error('VOZ_DURACAO_NAO_COMPROVADA'); }

function wav(b: Buffer): DuracaoAudioVoz {
  if (b.length < 44 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE' || b.readUInt32LE(4) + 8 !== b.length) recusado();
  let pos = 12, alinhamento = 0, taxa = 0, canais: 1 | 2 | undefined, dados = 0, chunks = 0;
  while (pos < b.length) {
    if (pos + 8 > b.length || ++chunks > 64) recusado();
    const id = b.toString('ascii', pos, pos + 4), tamanho = b.readUInt32LE(pos + 4), inicio = pos + 8, fim = inicio + tamanho;
    if (fim > b.length || fim + (tamanho % 2) > b.length) recusado();
    if (id === 'fmt ') {
      if (taxa || ![16, 18].includes(tamanho) || tamanho === 18 && b.readUInt16LE(inicio + 16) !== 0) recusado();
      const c = b.readUInt16LE(inicio + 2), hz = b.readUInt32LE(inicio + 4), bloco = b.readUInt16LE(inicio + 12);
      if (b.readUInt16LE(inicio) !== 1 || c !== 1 && c !== 2 || hz < 8000 || hz > 48000 || b.readUInt16LE(inicio + 14) !== 16 || bloco !== c * 2 || b.readUInt32LE(inicio + 8) !== hz * bloco) recusado();
      canais = c; taxa = hz; alinhamento = bloco;
    } else if (id === 'data') {
      if (!taxa || dados || !tamanho || tamanho % alinhamento) recusado();
      dados = tamanho;
    } else if (tamanho > 64 * 1024) recusado();
    pos = fim + (tamanho % 2);
  }
  if (!dados || !canais || pos !== b.length) recusado();
  return { duracaoMs: Math.ceil(dados / alinhamento / taxa * 1000), canais, formato: 'wav-pcm' };
}

const tabelaCRC = Array.from({ length: 256 }, (_, indice) => {
  let valor = indice << 24;
  for (let i = 0; i < 8; i++) valor = valor & 0x80000000 ? (valor << 1) ^ 0x04c11db7 : valor << 1;
  return valor >>> 0;
});
function crcPagina(b: Buffer, inicio: number, fim: number): number {
  let valor = 0;
  for (let i = inicio; i < fim; i++) {
    const byte = i >= inicio + 22 && i < inicio + 26 ? 0 : b[i];
    valor = ((valor << 8) ^ tabelaCRC[((valor >>> 24) ^ byte) & 255]) >>> 0;
  }
  return valor;
}

/** RFC6716: a duração vem dos quadros efetivos, nunca apenas do granule do
 * contêiner. Valida também o empacotamento para rejeitar duração subestimada. */
function amostrasOpus(p: Buffer): number {
  if (!p.length || p.length > 64 * 1024) recusado();
  const toc = p[0], codigo = toc & 3;
  const amostras = toc & 0x80 ? 120 << ((toc >> 3) & 3) : (toc & 0x60) === 0x60 ? (toc & 8 ? 960 : 480) : [480, 960, 1920, 2880][(toc >> 3) & 3];
  let pos = 1, fim = p.length, quantidade = codigo === 0 ? 1 : 2;
  const lerTamanho = () => {
    if (pos >= fim) recusado();
    const a = p[pos++];
    if (a < 252) return a;
    if (pos >= fim) recusado();
    return a + 4 * p[pos++];
  };
  if (codigo === 0) {
    if (fim - pos > 1275) recusado();
  } else if (codigo === 1) {
    if ((fim - pos) % 2 || (fim - pos) / 2 > 1275) recusado();
  } else if (codigo === 2) {
    const primeiro = lerTamanho(), segundo = fim - pos - primeiro;
    if (primeiro > 1275 || segundo < 0 || segundo > 1275) recusado();
  } else {
    if (p.length < 2) recusado();
    const controle = p[pos++]; quantidade = controle & 63;
    if (!quantidade || quantidade > 48) recusado();
    if (controle & 64) {
      let preenchimento = 0, valor: number;
      do {
        if (pos >= fim) recusado();
        valor = p[pos++]; preenchimento += valor === 255 ? 254 : valor;
        if (preenchimento > p.length) recusado();
      } while (valor === 255);
      fim -= preenchimento;
      if (fim < pos) recusado();
    }
    if (controle & 128) {
      let usados = 0;
      for (let i = 1; i < quantidade; i++) {
        const tamanho = lerTamanho(); if (tamanho > 1275) recusado(); usados += tamanho;
      }
      const ultimo = fim - pos - usados;
      if (ultimo < 0 || ultimo > 1275) recusado();
    } else if ((fim - pos) % quantidade || (fim - pos) / quantidade > 1275) recusado();
  }
  if (amostras * quantidade > 5760) recusado();
  return amostras * quantidade;
}

function conferirTags(p: Buffer) {
  if (p.length < 16 || p.toString('ascii', 0, 8) !== 'OpusTags') recusado();
  let pos = 12 + p.readUInt32LE(8);
  if (pos + 4 > p.length) recusado();
  const quantidade = p.readUInt32LE(pos); pos += 4;
  if (quantidade > 1000) recusado();
  for (let i = 0; i < quantidade; i++) {
    if (pos + 4 > p.length) recusado();
    pos += 4 + p.readUInt32LE(pos);
    if (pos > p.length) recusado();
  }
}

/** Suporte fechado: uma stream Opus completa, mapping0, sem multiplexação,
 * encadeamento, perdas ou offset de corte. Outros formatos ficam para apoio
 * humano. Não decodifica voz nem executa ferramenta externa. RFC7845/6716. */
function ogg(b: Buffer): DuracaoAudioVoz {
  let pos = 0, serie: number | undefined, sequencia = 0, paginas = 0, pacote = 0, parcial: Buffer[] = [], tamanhoParcial = 0;
  let canais: 1 | 2 | undefined, preSkip = 0, total = 0, granuleAnterior = 0, acabou = false;
  while (pos < b.length) {
    if (acabou || pos + 27 > b.length || ++paginas > 32000 || b.toString('ascii', pos, pos + 4) !== 'OggS' || b[pos + 4] !== 0) recusado();
    const flags = b[pos + 5], s = b.readUInt32LE(pos + 14), seq = b.readUInt32LE(pos + 18), segmentos = b[pos + 26];
    if (flags & ~7 || seq !== sequencia++ || (paginas === 1 ? flags !== 2 : !!(flags & 2))) recusado();
    if (serie === undefined) serie = s; else if (serie !== s) recusado();
    if (!!(flags & 1) !== (tamanhoParcial > 0) || !segmentos || pos + 27 + segmentos > b.length) recusado();
    let fim = pos + 27 + segmentos;
    for (let i = 0; i < segmentos; i++) fim += b[pos + 27 + i];
    if (fim > b.length || crcPagina(b, pos, fim) !== b.readUInt32LE(pos + 22)) recusado();
    const gp = b.readBigUInt64LE(pos + 6), anteriorTotal = total;
    let dados = pos + 27 + segmentos, completados = 0, audioNaPagina = false;
    for (let i = 0; i < segmentos; i++) {
      const n = b[pos + 27 + i]; parcial.push(b.subarray(dados, dados + n)); tamanhoParcial += n; dados += n;
      if (tamanhoParcial > 64 * 1024) recusado();
      if (n === 255) continue;
      const p = Buffer.concat(parcial, tamanhoParcial); parcial = []; tamanhoParcial = 0; completados++;
      if (pacote === 0) {
        const c = p[9];
        if (p.length !== 19 || p.toString('ascii', 0, 8) !== 'OpusHead' || p[8] !== 1 || c !== 1 && c !== 2 || p[18] !== 0 || paginas !== 1 || segmentos !== 1) recusado();
        canais = c; preSkip = p.readUInt16LE(10);
      } else if (pacote === 1) conferirTags(p);
      else { audioNaPagina = true; total += amostrasOpus(p); }
      pacote++;
      if (total > MAX_DURACAO_VOZ_SEGUNDOS * 48000) throw Error('VOZ_DURACAO_EXCEDIDA');
    }
    if (audioNaPagina) {
      if (gp > BigInt(total) || gp < BigInt(granuleAnterior) || !(flags & 4) && gp !== BigInt(total) || flags & 4 && gp < BigInt(anteriorTotal)) recusado();
      granuleAnterior = Number(gp);
    } else if (completados ? gp !== BigInt(granuleAnterior) : gp !== BigInt('18446744073709551615')) recusado();
    if (flags & 4) {
      if (tamanhoParcial || !audioNaPagina || gp < BigInt(preSkip)) recusado();
      acabou = true;
    }
    pos = fim;
  }
  if (!acabou || pacote < 3 || !canais || total <= preSkip) recusado();
  // Inclui pre-skip/trim na medida conservadora de entrada enviada ao STT.
  return { duracaoMs: Math.ceil(total / 48), canais, formato: 'ogg-opus' };
}

export function conferirDuracaoAudioVoz(bytes: Uint8Array, mime: string, maxSegundos = MAX_DURACAO_VOZ_SEGUNDOS): DuracaoAudioVoz {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > MAX_BYTES || !Number.isSafeInteger(maxSegundos) || maxSegundos < 1 || maxSegundos > MAX_DURACAO_VOZ_SEGUNDOS) recusado();
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const resultado = mime === 'audio/wav' ? wav(b) : mime === 'audio/ogg' ? ogg(b) : recusado();
  if (resultado.duracaoMs < 100) recusado();
  if (resultado.duracaoMs > maxSegundos * 1000) throw Error('VOZ_DURACAO_EXCEDIDA');
  return resultado;
}
