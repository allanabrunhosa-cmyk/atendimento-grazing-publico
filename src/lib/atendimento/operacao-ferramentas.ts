import 'server-only';
import { createHash } from 'node:crypto';
import type { FerramentaIA, FonteIA, TarefaIA } from './ia-orquestrador';
import { conferirDuracaoAudioVoz, MAX_CARACTERES_SINTESE_VOZ, MAX_DURACAO_VOZ_SEGUNDOS } from './voz-duracao';
export {criarConsultasWoo} from './operacao-woo-consultas';
export type {ConfiguracaoConsultasWoo,VinculoOfertaWoo,OfertaWooConsultada,IdentidadePedidoWoo,PedidoWooAutorizado,BuscaPedidosWoo} from './operacao-woo-consultas';

export type CredenciaisWoo = { site: string; chave: string; segredo: string };
export type ConsumoVoz = {
  observado: boolean; duracaoEntradaMs?: number; caracteresEntrada?: number;
  caracteresCobrados?: number; requisicaoId?: string; rastreioId?: string;
};
export type ObservacaoConsumoVoz = {
  operacao: 'transcricao' | 'sintese'; provedor: 'elevenlabs'; modelo: string;
  resultado: 'concluida' | 'incerta' | 'recusada'; consumo: ConsumoVoz;
};
export type CredenciaisVoz = {
  chave: string; vozId?: string; modelo?: string; maxDuracaoSegundos?: number; maxCaracteres?: number;
  registrarConsumo?: (observacao: ObservacaoConsumoVoz) => Promise<void> | void;
};
export class FalhaVozDireta extends Error {
  constructor(readonly operacao: 'transcricao' | 'sintese', readonly resultado: 'incerto' | 'recusado', readonly consumo: ConsumoVoz) {
    super(operacao === 'transcricao' ? 'VOZ_TRANSCRICAO_INDISPONIVEL' : 'VOZ_SINTESE_INDISPONIVEL'); this.name = 'FalhaVozDireta';
  }
}
type ProdutoWoo = { id: number; name: string; price: string; stock_status: string; stock_quantity: number | null; purchasable: boolean; status: string };
const objeto = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const limpar = (s: string, max: number) => s.replace(/<[^>]*>/g, '').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, max);
const versao = (s: string) => createHash('sha256').update(s).digest().readUInt32BE(0) + 1;
export function buscaCatalogo(pergunta:string) {
 const vazias=new Set('qual quais quanto custa custam preco preço valor valores voce você voces vocês tem têm teria gostaria quero queria preciso saber poderia pode podem por favor para pessoas pessoa uma um uns umas a o os as de da do das dos e é eh na no nos nas com me mim eu boa bom dia tarde noite catalogo catálogo cardapio cardápio produto produtos opcoes opções disponíveis disponiveis disponibilidade esse essa esses essas este esta estes estas deste desta desse dessa isso aquele aquela foto imagem'.split(' '));
 return pergunta.normalize('NFKC').toLocaleLowerCase('pt-BR').match(/[\p{L}][\p{L}\p{N}-]*/gu)?.filter(v=>!vazias.has(v)&&v.length>1).slice(0,6).join(' ').slice(0,160)??'';
}
function validarProdutos(dados:unknown):ProdutoWoo[]{
 if(!Array.isArray(dados)||dados.length>10)throw Error('WOO_RESPOSTA_INVALIDA');
 return dados.map(p=>{
  if(!objeto(p)||!Number.isSafeInteger(p.id)||Number(p.id)<1||typeof p.name!=='string'||typeof p.price!=='string'||!/^\d{1,10}(?:\.\d{1,2})?$/.test(p.price)||typeof p.stock_status!=='string'||!['instock','outofstock','onbackorder'].includes(p.stock_status)||typeof p.purchasable!=='boolean'||p.status!=='publish'||p.stock_quantity!==null&&(!Number.isSafeInteger(p.stock_quantity)||Number(p.stock_quantity)<0))throw Error('WOO_PRODUTO_INVALIDO');
  return {id:Number(p.id),name:limpar(p.name,200),price:p.price,stock_status:p.stock_status,stock_quantity:p.stock_quantity as number|null,purchasable:p.purchasable,status:p.status};
 });
}
async function lerResposta(r: Response, max: number): Promise<Buffer> {
  if (!r.ok || !r.body) throw Error('FERRAMENTA_INDISPONIVEL');
  const tamanho = Number(r.headers.get('content-length'));
  if (Number.isFinite(tamanho) && tamanho > max) throw Error('FERRAMENTA_RESPOSTA_EXCESSIVA');
  const leitor = r.body.getReader(), partes: Uint8Array[] = []; let bytes = 0;
  try { for (;;) { const b = await leitor.read(); if (b.done) break; bytes += b.value.byteLength; if (bytes > max) { await leitor.cancel(); throw Error('FERRAMENTA_RESPOSTA_EXCESSIVA'); } partes.push(b.value); } }
  finally { leitor.releaseLock(); }
  return Buffer.concat(partes);
}

/** As únicas operações Woo disponíveis são leitura de catálogo e pedido já
 * vinculado pelo servidor ao contato. Nunca aceita URL, pedido ou cliente do
 * modelo. Credenciais usam cabeçalho, sem query string/erro do fornecedor/log. */
export function criarFerramentasWoo(config: CredenciaisWoo, transporte: typeof fetch = fetch) {
  const site = new URL(config.site);
  if (site.protocol !== 'https:' || site.username || site.password || site.search || site.hash || site.port || !/^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(site.hostname) || /^\d+(?:\.\d+){3}$/.test(site.hostname) || !config.chave || !config.segredo || config.chave.length > 512 || config.segredo.length > 512) throw Error('WOO_CONFIGURACAO_INVALIDA');
  const base = site.href.replace(/\/$/, '') + '/wp-json/wc/v3/';
  async function get(caminho: string, signal: AbortSignal) {
    try {
      const r = await transporte(base + caminho, { method: 'GET', headers: { Authorization: 'Basic ' + Buffer.from(config.chave + ':' + config.segredo).toString('base64'), Accept: 'application/json' }, redirect: 'error', cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]) });
      return JSON.parse((await lerResposta(r, 256 * 1024)).toString('utf8')) as unknown;
    } catch { throw Error('WOO_LEITURA_INDISPONIVEL'); }
  }
  return {
    async produtos(busca: string, signal: AbortSignal): Promise<ProdutoWoo[]> {
      if (typeof busca !== 'string' || !busca.trim() || busca.length > 160 || /[\x00-\x1f]/.test(busca)) throw Error('WOO_BUSCA_INVALIDA');
      const dados = await get('products?' + new URLSearchParams({ search: busca.trim(), per_page: '10', status: 'publish' }), signal);
      return validarProdutos(dados);
    },
    async catalogo(signal:AbortSignal){return validarProdutos(await get('products?'+new URLSearchParams({per_page:'10',status:'publish'}),signal));},
    async pedido(vinculo: { numero: number; clienteWooId: number }, signal: AbortSignal) {
      if (!Number.isSafeInteger(vinculo.numero) || vinculo.numero < 1 || !Number.isSafeInteger(vinculo.clienteWooId) || vinculo.clienteWooId < 1) throw Error('WOO_PEDIDO_NAO_VINCULADO');
      const p = await get('orders/' + vinculo.numero, signal);
      if (!objeto(p) || p.id !== vinculo.numero || p.customer_id !== vinculo.clienteWooId || typeof p.status !== 'string' || !['pending', 'processing', 'on-hold', 'completed', 'cancelled', 'refunded', 'failed', 'checkout-draft'].includes(p.status)) throw Error('WOO_PEDIDO_ESCOPO_RECUSADO');
      return { numero: vinculo.numero, estado: p.status };
    },
  };
}

export function fontesProdutos(t: TarefaIA, produtos: ProdutoWoo[], agora = Date.now()): FonteIA[] {
  return produtos.map(p => {
    const estado = { instock: 'disponível', outofstock: 'indisponível', onbackorder: 'sob encomenda, sujeito à confirmação humana' }[p.stock_status];
    const preco = p.price.replace('.', ',');
    const conteudo = `${p.name}: R$ ${preco}. Disponibilidade consultada agora: ${estado}.${p.purchasable ? '' : ' A compra está indisponível no catálogo.'}`;
    return { id: `woo_produto_${p.id}`, versao: versao(JSON.stringify(p)), empresaId: t.empresaId, clienteId: t.clienteId, tema: t.tema, origem: 'ferramenta', estado: 'aprovado', inicio: agora, fim: agora + 60000, conteudo, chave: `woo_produto_${p.id}`, valor: JSON.stringify(p) };
  });
}

export type LeituraFerramentas = {
  woo?: ReturnType<typeof criarFerramentasWoo>;
  vinculoPedido: (t: TarefaIA) => Promise<{ numero: number; clienteWooId: number } | null>;
  agenda: (t: TarefaIA) => Promise<string[]>;
  entrega: (t: TarefaIA) => Promise<string[]>;
  agora?: () => number;
};
export function criarLeituraFerramentas(d: LeituraFerramentas) {
  return async (nome: FerramentaIA, t: TarefaIA, signal: AbortSignal): Promise<FonteIA[]> => {
    const agora = d.agora?.() ?? Date.now();
    if (signal.aborted) throw Error('IA_PROCESSAMENTO_CANCELADO');
    if (nome === 'search_products') {
      if (!d.woo) throw Error('WOO_NAO_CONFIGURADO');
      // Uma única leitura limitada: retira termos conversacionais para não
      // buscar a frase inteira no Woo. Pedido genérico lê a primeira página,
      // sem alegar catálogo completo nem interpolar IDs/URLs vindos da IA.
      const busca=buscaCatalogo(t.pergunta);
      return fontesProdutos(t,busca?await d.woo.produtos(busca,signal):await d.woo.catalogo(signal),agora);
    }
    let fatos: string[];
    if (nome === 'get_order') {
      const vinculo = await d.vinculoPedido(t); if (!d.woo || !vinculo) throw Error('WOO_PEDIDO_NAO_VINCULADO');
      const p = await d.woo.pedido(vinculo, signal);
      const estados: Record<string, string> = { pending: 'aguardando pagamento', processing: 'em processamento', 'on-hold': 'em espera', completed: 'concluído', cancelled: 'cancelado', refunded: 'reembolsado', failed: 'falhou', 'checkout-draft': 'rascunho ainda não confirmado' };
      fatos = [`Pedido #${p.numero}: ${estados[p.estado]}.`];
    } else if (nome === 'available_slots') fatos = await d.agenda(t);
    else if (nome === 'delivery_conditions') fatos = await d.entrega(t);
    else throw Error('IA_FERRAMENTA_RECUSADA');
    if (signal.aborted || fatos.length > 10 || fatos.some(f => typeof f !== 'string' || !f.trim() || f.length > 3000)) throw Error('IA_FERRAMENTA_INVALIDA');
    return fatos.map((conteudo, i) => ({ id: `${nome}_${i}`, versao: versao(conteudo), empresaId: t.empresaId, clienteId: t.clienteId, tema: t.tema, origem: 'ferramenta', estado: 'aprovado', inicio: agora, fim: agora + 60000, conteudo }));
  };
}

/** Transporte direto do fornecedor já usado na origem. O chamador deve reservar
 * orçamento antes de STT/TTS. Bytes autorizados, nunca uma URL arbitrária. */
export function criarVozDireta(config: CredenciaisVoz, transporte: typeof fetch = fetch) {
  const maxDuracao = config.maxDuracaoSegundos ?? MAX_DURACAO_VOZ_SEGUNDOS, maxCaracteres = config.maxCaracteres ?? MAX_CARACTERES_SINTESE_VOZ;
  if (!config.chave || config.chave.length > 512 || /[\r\n]/.test(config.chave) || config.vozId && !/^[A-Za-z0-9]{1,100}$/.test(config.vozId) || config.modelo && !/^eleven_[a-z0-9_]{1,80}$/.test(config.modelo) || !Number.isSafeInteger(maxDuracao) || maxDuracao < 1 || maxDuracao > MAX_DURACAO_VOZ_SEGUNDOS || !Number.isSafeInteger(maxCaracteres) || maxCaracteres < 1 || maxCaracteres > MAX_CARACTERES_SINTESE_VOZ) throw Error('VOZ_CONFIGURACAO_INVALIDA');
  async function registrar(o: ObservacaoConsumoVoz) {
    try { await config.registrarConsumo?.(o); }
    catch { throw new FalhaVozDireta(o.operacao, 'incerto', o.consumo); }
  }
  function metadados(r: Response, entrada: ConsumoVoz): ConsumoVoz {
    const custo = r.headers.get('character-cost'), requisicao = r.headers.get('request-id'), rastreio = r.headers.get('x-trace-id');
    const valor = custo !== null && /^\d{1,7}(?:\.\d{1,4})?$/.test(custo) ? Number(custo) : undefined;
    return { ...entrada, observado: valor !== undefined, ...(valor !== undefined ? { caracteresCobrados: valor } : {}), ...(requisicao && /^[A-Za-z0-9_.:-]{1,200}$/.test(requisicao) ? { requisicaoId: requisicao } : {}), ...(rastreio && /^[A-Za-z0-9_.:-]{1,200}$/.test(rastreio) ? { rastreioId: rastreio } : {}) };
  }
  const resultadoHttp = (r: Response) => r.status >= 400 && r.status < 500 && r.status !== 408 ? 'recusado' as const : 'incerto' as const;
  return {
    async transcrever(bytes: Uint8Array, mime: string, signal: AbortSignal) {
      if (!['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm'].includes(mime) || !bytes.byteLength || bytes.byteLength > 10 * 1024 * 1024 || signal.aborted) throw Error('VOZ_AUDIO_INVALIDO');
      const audio = conferirDuracaoAudioVoz(bytes, mime, maxDuracao);
      const body = new FormData(); body.append('file', new Blob([Uint8Array.from(bytes)], { type: mime }), 'audio'); body.append('model_id', 'scribe_v1'); body.append('language_code', 'por');
      // Sem URLs, webhooks, multicanal ou complementos com sobretaxa. A reserva
      // estimada do chamador antecede a chamada; este limite antecede o POST.
      body.append('use_multi_channel', 'false'); body.append('webhook', 'false'); body.append('diarize', 'false');
      let consumo: ConsumoVoz = { observado: false, duracaoEntradaMs: audio.duracaoMs }, texto: string;
      try {
        const r = await transporte('https://api.elevenlabs.io/v1/speech-to-text', { method: 'POST', headers: { 'xi-api-key': config.chave }, body, redirect: 'error', cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) });
        consumo = metadados(r, consumo);
        if (!r.ok) throw new FalhaVozDireta('transcricao', resultadoHttp(r), consumo);
        const dados: unknown = JSON.parse((await lerResposta(r, 128 * 1024)).toString());
        if (!objeto(dados) || typeof dados.text !== 'string' || !dados.text.trim() || dados.text.length > 4000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(dados.text)) throw Error();
        texto = dados.text;
      } catch (e) {
        const falha = e instanceof FalhaVozDireta ? e : new FalhaVozDireta('transcricao', 'incerto', consumo);
        await registrar({ operacao: 'transcricao', provedor: 'elevenlabs', modelo: 'scribe_v1', resultado: falha.resultado === 'incerto' ? 'incerta' : 'recusada', consumo: falha.consumo });
        throw falha;
      }
      await registrar({ operacao: 'transcricao', provedor: 'elevenlabs', modelo: 'scribe_v1', resultado: 'concluida', consumo });
      return { texto, provedor: 'elevenlabs', modelo: 'scribe_v1', confiavelComoTranscricao: true, consumo } as const;
    },
    async sintetizar(texto: string, signal: AbortSignal) {
      if(!config.vozId)throw Error('VOZ_ID_NAO_CONFIGURADO');
      if (typeof texto !== 'string' || !texto.trim() || texto.length > maxCaracteres || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(texto) || signal.aborted) throw Error('VOZ_TEXTO_INVALIDO');
      const modelo = config.modelo ?? 'eleven_turbo_v2_5';
      let consumo: ConsumoVoz = { observado: false, caracteresEntrada: texto.length }, bytes: Buffer;
      try {
        const r = await transporte(`https://api.elevenlabs.io/v1/text-to-speech/${config.vozId}`, { method: 'POST', headers: { 'xi-api-key': config.chave, 'Content-Type': 'application/json', Accept: 'audio/mpeg' }, body: JSON.stringify({ text: texto, model_id: modelo }), redirect: 'error', cache: 'no-store', signal: AbortSignal.any([signal, AbortSignal.timeout(20000)]) });
        consumo = metadados(r, consumo);
        if (!r.ok) throw new FalhaVozDireta('sintese', resultadoHttp(r), consumo);
        if (!r.headers.get('content-type')?.toLowerCase().startsWith('audio/mpeg')) throw Error();
        bytes = await lerResposta(r, 10 * 1024 * 1024); if (!bytes.length) throw Error();
      } catch (e) {
        const falha = e instanceof FalhaVozDireta ? e : new FalhaVozDireta('sintese', 'incerto', consumo);
        await registrar({ operacao: 'sintese', provedor: 'elevenlabs', modelo, resultado: falha.resultado === 'incerto' ? 'incerta' : 'recusada', consumo: falha.consumo });
        throw falha;
      }
      await registrar({ operacao: 'sintese', provedor: 'elevenlabs', modelo, resultado: 'concluida', consumo });
      return { bytes, mime: 'audio/mpeg', consumo } as const;
    },
  };
}
