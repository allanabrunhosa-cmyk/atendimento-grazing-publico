import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { assinaturaValida, criarWebhook, extrairEventos, LIMITE_WEBHOOK_BYTES, type Recebimento } from "@/lib/atendimento/webhook";
const config = { appSecret: "segredo-ficticio", verifyToken: "verificacao-ficticia", wabas: ["waba-1", "waba-2"], numeros: ["numero-1", "numero-2"] };
const change = (numero: string, itens: Record<string, unknown>) => ({ field: "messages", value: { metadata: { phone_number_id: numero }, ...itens } });
const payload = { object: "whatsapp_business_account", entry: [
  { id: "waba-1", changes: [change("numero-1", { messages: [{ id: "m1", type: "text", text: { body: "fictício" } }, { id: "m2", type: "audio" }], statuses: [{ id: "s1", status: "delivered", timestamp: "2" }] }), change("numero-1", { statuses: [{ id: "s1", status: "sent", timestamp: "1" }] })] },
  { id: "waba-2", changes: [change("numero-2", { messages: [{ id: "m3" }], errors: [{ code: 123 }] }), { field: "message_template_status_update", value: { event: "APPROVED", message_template_id: "t1" } }] },
] };
const corpo = Buffer.from(JSON.stringify(payload));
const assinar = (bytes: Buffer) => "sha256=" + createHmac("sha256", config.appSecret).update(bytes).digest("hex");
const post = (bytes = corpo, assinatura: string | null = assinar(bytes)) => new Request("https://atendimento.grazinghub.com.br/api/atendimento/webhook", { method: "POST", body: new Uint8Array(bytes), headers: assinatura ? { "x-hub-signature-256": assinatura } : {} });
describe("Webhook da Grazing sem efeitos externos", () => {
  it("confere os bytes originais, incluindo espaços e acentos", () => {
    expect(assinaturaValida(corpo, assinar(corpo), config.appSecret)).toBe(true);
    expect(assinaturaValida(Buffer.concat([corpo, Buffer.from(" ")]), assinar(corpo), config.appSecret)).toBe(false);
  });
  it.each([null, "sha1=abc", "sha256=xx", "sha256=" + "0".repeat(64)])("recusa assinatura inválida %s", async assinatura => {
    const persistir = vi.fn();
    expect((await criarWebhook(config, persistir)(post(corpo, assinatura))).status).toBe(401);
    expect(persistir).not.toHaveBeenCalled();
  });
  it("processa todas as entradas, mensagens, status, erros e mudanças administrativas", () => {
    const eventos = extrairEventos(corpo, config);
    expect(eventos).toHaveLength(7);
    expect(eventos.filter(e => e.tipo === "mensagem")).toHaveLength(3);
    expect(eventos.filter(e => e.tipo === "status")).toHaveLength(2);
    expect(new Set(eventos.map(e => e.chave)).size).toBe(7);
  });
  it("deduplica mensagens e distingue mudanças de status fora de ordem", () => {
    const eventos = extrairEventos(corpo, config);
    expect(eventos.map(e => e.chave)).toEqual(extrairEventos(corpo, config).map(e => e.chave));
    const repetida = Buffer.from(JSON.stringify({ ...payload, entry: [{ id: "waba-1", changes: [change("numero-1", { messages: [{ id: "m1", type: "text", text: { body: "mesmo id" } }] })] }] }));
    expect(extrairEventos(repetida, config)[0].chave).toBe(eventos[0].chave);
    expect(eventos[2].chave).not.toBe(eventos[3].chave);
  });
  it("preserva integralmente a resposta oficial de botão antes de confirmar", async () => {
    const item={id:"wamid.fixture-botao",from:"5511999990077",timestamp:"1791590400",type:"button",button:{text:"Falar com a equipe",payload:"encerrar"}};
    const bytes=Buffer.from(JSON.stringify({object:"whatsapp_business_account",entry:[{id:"waba-1",changes:[change("numero-1",{messages:[item]})]}]}));
    const persistir=vi.fn<(r:Recebimento)=>Promise<void>>(async r=>{
      expect(r.corpo.equals(bytes)).toBe(true);
      expect(r.eventos[0].conteudo.item).toEqual(item);
    });
    expect((await criarWebhook(config,persistir)(post(bytes))).status).toBe(200);
    expect(persistir).toHaveBeenCalledOnce();
  });
  it("não confirma antes de finalizar a persistência", async () => {
    let liberar!: () => void;
    let respondeu = false;
    const persistir = vi.fn<(recebimento: Recebimento) => Promise<void>>(() => new Promise<void>(resolve => { liberar = resolve; }));
    const chamada = criarWebhook(config, persistir)(post()).then(r => { respondeu = true; return r; });
    await vi.waitFor(() => expect(persistir).toHaveBeenCalledOnce());
    expect(respondeu).toBe(false);
    liberar();
    expect((await chamada).status).toBe(200);
    expect(persistir.mock.calls[0][0]).toMatchObject({ corpo, eventos: expect.any(Array) });
  });
  it("falha de banco pede nova entrega sem revelar payload ou segredo", async () => {
    const r = await criarWebhook(config, async () => { throw new Error("segredo-interno"); })(post());
    expect(r.status).toBe(503); expect(await r.text()).toBe("Persistência indisponível.");
  });
  it("recusa WABA/número fora do escopo antes do banco", async () => {
    const persistir = vi.fn();
    expect((await criarWebhook({ ...config, numeros: ["outro"] }, persistir)(post())).status).toBe(403);
    expect(persistir).not.toHaveBeenCalled();
  });
  it("valida desafio e token de verificação", async () => {
    const tratar = criarWebhook(config, vi.fn());
    const url = "https://atendimento.grazinghub.com.br/api/atendimento/webhook?hub.mode=subscribe&hub.challenge=123&hub.verify_token=";
    expect(await (await tratar(new Request(url + config.verifyToken))).text()).toBe("123");
    expect((await tratar(new Request(url + "invalido"))).status).toBe(403);
  });
  it("permanece indisponível sem configuração e recusa métodos impróprios", async () => {
    expect((await criarWebhook(null, vi.fn())(post())).status).toBe(503);
    expect((await criarWebhook(config, vi.fn())(new Request("https://atendimento.grazinghub.com.br", { method: "PUT" }))).status).toBe(405);
  });
  it("limita corpo declarado e corpo recebido sem Content-Length", async () => {
    const grande = Buffer.alloc(LIMITE_WEBHOOK_BYTES + 1, 32);
    const persistir = vi.fn();
    expect((await criarWebhook(config, persistir)(post(grande))).status).toBe(413);
    const declarado = post(); declarado.headers.set("content-length", String(LIMITE_WEBHOOK_BYTES + 1));
    expect((await criarWebhook(config, persistir)(declarado)).status).toBe(413);
    expect(persistir).not.toHaveBeenCalled();
  });
});
