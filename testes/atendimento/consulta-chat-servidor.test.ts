import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, open, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
import { request, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { criarServidorConsultaChat, CSP_CONSULTA_CHAT, ROTAS_CONSULTA_CHAT } from "../../scripts/atendimento/consulta-chat-servidor";
import { criarAutorizadorPreview, COOKIE_HOMOLOGACAO, HOST_PREVIEW, type AutorizarPreview, type ResultadoAutorizacaoPreview } from "../../scripts/atendimento/preview-protecao";

vi.mock("node:fs/promises", async importOriginal => {
  const real = await importOriginal<typeof import("node:fs/promises")>();
  return { ...real, open: vi.fn(real.open) };
});

describe("servidor isolado da interface de consulta", () => {
  let raiz: string, servidor: Server, porta: number, acesso: ResultadoAutorizacaoPreview;
  const autorizar = vi.fn<AutorizarPreview>(async () => acesso);
  async function consultar(caminho: string, metodo = "GET", host = HOST_PREVIEW, cookie?: string) {
    return new Promise<{ codigo: number; corpo: string; headers: Record<string, unknown> }>((concluir, rejeitar) => {
      const req = request({ hostname: "127.0.0.1", port: porta, path: caminho, method: metodo, headers: { Host: host, ...(cookie ? { Cookie: cookie } : {}) } }, res => {
        const partes: Buffer[] = [];
        res.on("data", parte => partes.push(parte));
        res.on("end", () => concluir({ codigo: res.statusCode!, corpo: Buffer.concat(partes).toString(), headers: res.headers }));
        res.on("error", rejeitar);
      });
      req.on("error", rejeitar); req.end();
    });
  }
  async function iniciar(limiteConcorrencia?: number, acessoPersonalizado: AutorizarPreview = autorizar) {
    servidor = criarServidorConsultaChat({ raiz, autorizar: acessoPersonalizado, limiteConcorrencia });
    await new Promise<void>(concluir => servidor.listen(0, "127.0.0.1", concluir));
    porta = (servidor.address() as AddressInfo).port;
  }
  async function fechar() {
    await new Promise<void>((concluir, rejeitar) => servidor.close(erro => erro ? rejeitar(erro) : concluir()));
  }
  function validarTemporario(pasta: string) {
    if (!resolve(pasta).startsWith(resolve(tmpdir()) + sep + "donatella-consulta-interface-ficticia-")) throw Error("DIRETORIO_TEMPORARIO_DIVERGENTE");
  }
  beforeEach(async () => {
    raiz = await mkdtemp(join(tmpdir(), "donatella-consulta-interface-ficticia-"));
    await mkdir(join(raiz, "assets"));
    await writeFile(join(raiz, "index.html"), "<p>Interface de consulta — carga fictícia do teste</p>");
    for (const [nome, conteudo] of [["chat-a1.js", "console.log('ficticio');"], ["chat-a1.css", "p{color:purple}"], ["identidade.svg", "<svg xmlns='http://www.w3.org/2000/svg'></svg>"], ["fonte.woff2", "FONTE_FICTICIA"]]) await writeFile(join(raiz, "assets", nome), conteudo);
    await writeFile(join(raiz, "segredo.json"), "NAO_ABRIR");
    await writeFile(join(raiz, ".env"), "NAO_ABRIR");
    acesso = "permitido"; autorizar.mockReset(); autorizar.mockImplementation(async () => acesso); vi.mocked(open).mockClear();
    await iniciar();
  });
  afterEach(async () => {
    await fechar(); validarTemporario(raiz);
    await rm(raiz, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("atende páginas diretas e assets próprios em GET e HEAD, revalidando antes da resposta", async () => {
    for (const rota of ["/consulta", "/consulta/", ...ROTAS_CONSULTA_CHAT.map(tela => `/consulta/${tela}`)]) {
      const resposta = await consultar(rota + "?filtro=ficticio");
      expect(resposta.codigo).toBe(200); expect(resposta.corpo).toContain("carga fictícia");
      expect(resposta.headers["content-type"]).toBe("text/html; charset=utf-8");
      expect(resposta.headers["cache-control"]).toBe("no-store");
      expect(resposta.headers["content-security-policy"]).toBe(CSP_CONSULTA_CHAT);
      const head = await consultar(rota, "HEAD"); expect(head.codigo).toBe(200); expect(head.corpo).toBe("");
      expect(head.headers["content-length"]).toBe(String(Buffer.byteLength(resposta.corpo)));
    }
    for (const [nome, mime] of [["chat-a1.js", "text/javascript; charset=utf-8"], ["chat-a1.css", "text/css; charset=utf-8"], ["identidade.svg", "image/svg+xml"], ["fonte.woff2", "font/woff2"]]) {
      expect(await consultar(`/consulta/assets/${nome}`)).toMatchObject({ codigo: 200, headers: { "content-type": mime } });
      expect(await consultar(`/consulta/assets/${nome}`, "HEAD")).toMatchObject({ codigo: 200, corpo: "" });
    }
    expect(autorizar).toHaveBeenCalledTimes(32);
  });
  it("CSP permite somente consultas no próprio host e impede scripts inline, mídia e frames externos", async () => {
    const resposta = await consultar("/consulta/chat");
    expect(CSP_CONSULTA_CHAT).toContain("connect-src 'self'");
    expect(CSP_CONSULTA_CHAT).toContain("script-src 'self';");
    expect(CSP_CONSULTA_CHAT).toContain("style-src 'self' 'unsafe-inline';");
    for (const diretiva of ["img-src 'self'", "font-src 'self'", "media-src 'none'", "object-src 'none'", "frame-ancestors 'none'", "form-action 'none'", "base-uri 'none'"]) expect(CSP_CONSULTA_CHAT).toContain(diretiva);
    expect(CSP_CONSULTA_CHAT).not.toMatch(/https:|data:|blob:|unsafe-eval/);
    expect(resposta.headers).toMatchObject({ "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-frame-options": "DENY", "cross-origin-resource-policy": "same-origin" });
  });
  it.each(["/consulta", "/consulta/chat", "/consulta/contatos", "/consulta/assets/chat-a1.js"])("redireciona %s ao login fixo sem entregar arquivo", async rota => {
    acesso = "login";
    expect(await consultar(rota)).toMatchObject({ codigo: 303, corpo: "", headers: { location: "/" } });
    expect(open).not.toHaveBeenCalled();
  });
  it("reutiliza a conferência da sessão exclusiva e não aceita cookies de outros ambientes", async () => {
    await fechar();
    const buscar = vi.fn(async () => new Response('{"somenteLeitura":true}', { headers: { "content-type": "application/json" } }));
    const conferir = criarAutorizadorPreview(buscar);
    await iniciar(undefined, vi.fn(conferir));
    expect((await consultar("/consulta/chat", "GET", HOST_PREVIEW, "hub=NAO_ENCAMINHAR")).codigo).toBe(303);
    expect(buscar).not.toHaveBeenCalled();
    expect((await consultar("/consulta/chat", "GET", HOST_PREVIEW, `${COOKIE_HOMOLOGACAO}=ficticio.assinatura; hub=NAO_ENCAMINHAR`)).codigo).toBe(200);
    expect(buscar).toHaveBeenCalledTimes(2);
    expect(buscar.mock.calls[0]).toEqual(["http://grazing-donatella-consulta-v2:3000/api/sessao", expect.objectContaining({ headers: { Cookie: `${COOKIE_HOMOLOGACAO}=ficticio.assinatura`, Host: HOST_PREVIEW } })]);
  });
  it("revogação durante a leitura impede enviar os bytes já carregados", async () => {
    const real = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let leu = false;
    vi.mocked(open).mockImplementationOnce(async (caminho, flags, modo) => {
      const arquivo = await real.open(caminho, flags, modo), ler = arquivo.read.bind(arquivo);
      Object.defineProperty(arquivo, "read", { value: async (buffer: Buffer, offset: number, length: number, position: number) => {
        const resultado = await ler(buffer, offset, length, position);
        leu = true; acesso = "login";
        return resultado;
      } });
      return arquivo;
    });
    const resposta = await consultar("/consulta/chat");
    expect(leu).toBe(true); expect(autorizar).toHaveBeenCalledTimes(2);
    expect(resposta).toMatchObject({ codigo: 303, corpo: "", headers: { location: "/" } });
  });
  it.each(["negado", "indisponivel"] as const)("recusa %s na revalidação final sem entregar a interface", async resultado => {
    autorizar.mockResolvedValueOnce("permitido").mockResolvedValueOnce(resultado);
    const resposta = await consultar("/consulta/chat");
    expect(resposta.codigo).toBe(resultado === "negado" ? 403 : 503);
    expect(resposta.corpo).not.toContain("carga fictícia");
    expect(autorizar).toHaveBeenCalledTimes(2);
  });
  it.each(["POST", "PUT", "PATCH", "DELETE", "OPTIONS"])("nega %s em todas as rotas, inclusive envio e login, sem proxy", async metodo => {
    for (const rota of ["/consulta", "/consulta/chat", "/consulta/assets/chat-a1.js", "/consulta/api/send", "/api/send", "/api/login", "/api/conversas", "/consulta/saude"]) {
      expect(await consultar(rota, metodo)).toMatchObject({ codigo: 405, headers: { allow: "GET, HEAD" } });
    }
    expect(autorizar).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
  });
  it.each(["/", "/api/sessao", "/api/conversas", "/consulta/api/send", "/consulta/.env", "/consulta/segredo.json", "/consulta/assets/.env", "/consulta/assets/chat-a1.js.map", "/consulta/assets/segredo.json", "/consulta/assets/subpasta/chat-a1.js", "/consulta/assets/../segredo.json", "/consulta/assets/%2e%2e/segredo.json", "/consulta/%63hat", "/consulta//chat", "/consulta\\chat", "/consulta/./chat", "/consulta/chat#fragmento", "/consulta/assets/imagem.png", "/consulta/unknown", `/consulta/chat?filtro=${"x".repeat(2048)}`])("fecha a rota crua %s antes da autorização e da leitura", async rota => {
    const resposta = await consultar(rota);
    expect(resposta.codigo).toBe(404); expect(resposta.corpo).not.toContain("NAO_ABRIR");
    expect(autorizar).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
  });
  it("recusa Host externo e localhost nas páginas de negócio", async () => {
    for (const host of ["outro.example.invalid", "localhost:3000", `${HOST_PREVIEW}:3000`]) expect((await consultar("/consulta/chat", "GET", host)).codigo).toBe(421);
    expect(autorizar).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
  });
  it("saúde anônima funciona em GET e HEAD e só expõe o contrato superficial", async () => {
    acesso = "login";
    for (const host of [HOST_PREVIEW, "localhost:3000"]) {
      const resposta = await consultar("/consulta/saude", "GET", host);
      expect(JSON.parse(resposta.corpo)).toEqual({ servico: "interface-consulta", somenteLeitura: true, enviosReais: false });
      expect(await consultar("/consulta/saude", "HEAD", host)).toMatchObject({ codigo: 200, corpo: "" });
    }
    expect(autorizar).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
  });
  it("recusa arquivo ausente e limita assets a 8 MiB sem ler seu conteúdo", async () => {
    expect((await consultar("/consulta/assets/ausente.js")).codigo).toBe(404);
    const grande = join(raiz, "assets", "grande.js");
    await writeFile(grande, ""); await truncate(grande, 8 * 1024 * 1024 + 1);
    expect((await consultar("/consulta/assets/grande.js")).codigo).toBe(404);
    expect(autorizar).toHaveBeenCalledTimes(2);
  });
  it("não abre um link da release que escape da raiz autorizada", async () => {
    const externa = await mkdtemp(join(tmpdir(), "donatella-consulta-interface-ficticia-"));
    try {
      await writeFile(join(externa, "privado.js"), "NAO_ABRIR");
      await symlink(externa, join(raiz, "assets", "escape.js"), "junction");
      const resposta = await consultar("/consulta/assets/escape.js");
      expect(resposta.codigo).toBe(404); expect(resposta.corpo).not.toContain("NAO_ABRIR"); expect(open).not.toHaveBeenCalled();
    } finally { validarTemporario(externa); await rm(externa, { recursive: true, force: true }); }
  });
  it("limita concorrência e libera a capacidade após concluir a requisição", async () => {
    await fechar(); await iniciar(1);
    let liberar!: () => void, avisar!: () => void;
    const iniciou = new Promise<void>(concluir => { avisar = concluir; });
    const bloqueada = new Promise<void>(concluir => { liberar = concluir; });
    autorizar.mockImplementationOnce(async () => { avisar(); await bloqueada; return "permitido"; });
    const primeira = consultar("/consulta/chat");
    await iniciou;
    try { expect(await consultar("/consulta/chat")).toMatchObject({ codigo: 503, headers: { "retry-after": "2", "cache-control": "no-store" } }); }
    finally { liberar(); }
    expect((await primeira).codigo).toBe(200);
    expect((await consultar("/consulta/chat")).codigo).toBe(200);
  });
  it.each([0, 9, -1, 1.5, NaN])("recusa limite de concorrência inválido %s", limiteConcorrencia => {
    expect(() => criarServidorConsultaChat({ raiz, autorizar, limiteConcorrencia })).toThrow("CONSULTA_LIMITE_INVALIDO");
  });
  it("erro privado do autorizador falha fechado sem refletir detalhes", async () => {
    autorizar.mockRejectedValueOnce(Error("SEGREDO_FICTICIO_NAO_REFLETIR"));
    expect(await consultar("/consulta/chat")).toMatchObject({ codigo: 503, corpo: '{"erro":"CONSULTA_INDISPONIVEL"}' });
    expect(open).not.toHaveBeenCalled();
  });
});
