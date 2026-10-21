import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const LIMITE_WEBHOOK_BYTES = 2 * 1024 * 1024;
export type EventoRecebido = { chave: string; tipo: "mensagem" | "status" | "alteracao"; waba: string; numero: string | null; conteudo: Record<string, unknown> };
export type Recebimento = { hash: string; corpo: Buffer; eventos: EventoRecebido[] };
export type ConfiguracaoWebhook = { appSecret: string; verifyToken: string; wabas: string[]; numeros: string[] };
export function assinaturaValida(corpo: Buffer, assinatura: string | null, segredo: string) {
  if (!segredo || !assinatura || !/^sha256=[a-f0-9]{64}$/i.test(assinatura)) return false;
  return timingSafeEqual(createHmac("sha256", segredo).update(corpo).digest(), Buffer.from(assinatura.slice(7), "hex"));
}
function objeto(valor: unknown): valor is Record<string, unknown> { return valor !== null && typeof valor === "object" && !Array.isArray(valor); }
function canonico(valor: unknown): string {
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(",")}]`;
  if (objeto(valor)) return `{${Object.keys(valor).sort().map(k => `${JSON.stringify(k)}:${canonico(valor[k])}`).join(",")}}`;
  return JSON.stringify(valor);
}
const hash = (valor: string | Buffer) => createHash("sha256").update(valor).digest("hex");

// O recibo guarda também o corpo original inteiro, inclusive mudanças desconhecidas.
export function extrairEventos(corpo: Buffer, config: Pick<ConfiguracaoWebhook, "wabas" | "numeros">): EventoRecebido[] {
  const payload: unknown = JSON.parse(corpo.toString("utf8"));
  if (!objeto(payload) || payload.object !== "whatsapp_business_account" || !Array.isArray(payload.entry)) throw new Error("PAYLOAD_INVALIDO");
  const eventos: EventoRecebido[] = [];
  for (const entry of payload.entry) {
    if (!objeto(entry) || typeof entry.id !== "string" || !Array.isArray(entry.changes)) throw new Error("PAYLOAD_INVALIDO");
    if (!config.wabas.includes(entry.id)) throw new Error("ASSINATURA_FORA_DO_ESCOPO");
    for (const change of entry.changes) {
      if (!objeto(change) || typeof change.field !== "string" || !objeto(change.value)) throw new Error("PAYLOAD_INVALIDO");
      const value = change.value;
      const numero = objeto(value.metadata) && typeof value.metadata.phone_number_id === "string" ? value.metadata.phone_number_id : null;
      if (numero && !config.numeros.includes(numero)) throw new Error("ASSINATURA_FORA_DO_ESCOPO");
      if (change.field === "messages" && !numero) throw new Error("PAYLOAD_INVALIDO");
      let itens = 0;
      for (const [campo, tipo] of [["messages", "mensagem"], ["statuses", "status"]] as const) {
        if (value[campo] !== undefined && !Array.isArray(value[campo])) throw new Error("PAYLOAD_INVALIDO");
        for (const item of (value[campo] ?? []) as unknown[]) {
          if (!objeto(item) || typeof item.id !== "string" || item.id.length > 512) throw new Error("PAYLOAD_INVALIDO");
          const identidade = tipo === "mensagem" ? item.id : canonico(item);
          eventos.push({ chave: hash(canonico([entry.id, numero, tipo, identidade])), tipo, waba: entry.id, numero, conteudo: { field: change.field, metadata: value.metadata ?? null, contacts: value.contacts ?? [], item } });
          itens++;
        }
      }
      if (!itens || value.errors !== undefined || Object.keys(value).some(k => !["messages", "statuses", "metadata", "contacts", "messaging_product"].includes(k))) {
        eventos.push({ chave: hash(canonico([entry.id, numero, change])), tipo: "alteracao", waba: entry.id, numero, conteudo: change });
      }
    }
  }
  return eventos;
}
async function lerCorpo(request: Request) {
  if (Number(request.headers.get("content-length")) > LIMITE_WEBHOOK_BYTES) throw new Error("CORPO_GRANDE");
  const reader = request.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const partes: Uint8Array[] = [];
  let tamanho = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      tamanho += value.byteLength;
      if (tamanho > LIMITE_WEBHOOK_BYTES) { await reader.cancel(); throw new Error("CORPO_GRANDE"); }
      partes.push(value);
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(partes);
}
const resposta = (texto: string, status: number) => new Response(texto, { status, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Content-Type": "text/plain; charset=utf-8" } });
export function criarWebhook(config: ConfiguracaoWebhook | null, persistir: (recebimento: Recebimento) => Promise<void>) {
  return async (request: Request) => {
    if (!config?.appSecret || !config.verifyToken || !config.wabas.length || !config.numeros.length) return resposta("Recebimento indisponível.", 503);
    if (request.method === "GET") {
      const parametros = new URL(request.url).searchParams;
      const recebido = Buffer.from(parametros.get("hub.verify_token") ?? "");
      const esperado = Buffer.from(config.verifyToken);
      const desafio = parametros.get("hub.challenge");
      if (parametros.get("hub.mode") !== "subscribe" || recebido.length !== esperado.length || !timingSafeEqual(recebido, esperado) || !desafio || desafio.length > 512) return resposta("Verificação recusada.", 403);
      return resposta(desafio, 200);
    }
    if (request.method !== "POST") return resposta("Método não permitido.", 405);
    let corpo: Buffer;
    try { corpo = await lerCorpo(request); } catch { return resposta("Corpo excede o limite.", 413); }
    if (!assinaturaValida(corpo, request.headers.get("x-hub-signature-256"), config.appSecret)) return resposta("Assinatura recusada.", 401);
    let eventos: EventoRecebido[];
    try { eventos = extrairEventos(corpo, config); } catch (erro) { return resposta("Evento recusado.", erro instanceof Error && erro.message === "ASSINATURA_FORA_DO_ESCOPO" ? 403 : 400); }
    try { await persistir({ corpo, hash: hash(corpo), eventos }); } catch { return resposta("Persistência indisponível.", 503); }
    return resposta("Recebido.", 200);
  };
}
