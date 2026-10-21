import { request, type IncomingMessage } from "node:http";

export const HOST_PREVIEW = "atendimento.grazinghub.com.br";
export const COOKIE_HOMOLOGACAO = "donatella_homologacao_v2";
const ENDERECO_SESSAO = "http://grazing-donatella-consulta-v2:3000/api/sessao";

export type ResultadoAutorizacaoPreview = "permitido" | "login" | "negado" | "indisponivel";
export type AutorizarPreview = (req: IncomingMessage) => Promise<ResultadoAutorizacaoPreview>;

/** O fetch do Node 22 troca Host pelo hostname interno. http.request preserva a autoridade fixa. */
export function criarBuscaSessaoHttp(endereco = ENDERECO_SESSAO): typeof fetch {
  return async (_entrada, opcoes = {}) => new Promise<Response>((concluir, rejeitar) => {
    const headers = new Headers(opcoes.headers);
    const req = request(endereco, { method: "GET", headers: { Host: HOST_PREVIEW, Cookie: headers.get("Cookie") ?? "" }, signal: opcoes.signal ?? undefined }, res => {
      const partes: Buffer[] = []; let bytes = 0;
      res.on("data", (parte: Buffer) => {
        bytes += parte.length;
        if (bytes > 4096) { rejeitar(new Error("RESPOSTA_SESSAO_EXCESSIVA")); req.destroy(); return; }
        partes.push(parte);
      });
      res.on("error", rejeitar);
      res.on("aborted", () => rejeitar(new Error("RESPOSTA_SESSAO_INTERROMPIDA")));
      res.on("end", () => concluir(new Response(Buffer.concat(partes).toString("utf8"), { status: res.statusCode ?? 503, headers: { "content-type": String(res.headers["content-type"] ?? "") } })));
    });
    req.on("error", rejeitar); req.end();
  });
}

/** Reutiliza a sessão existente sem conhecer senha, assinatura ou identidade privada. */
export function criarAutorizadorPreview(buscar: typeof fetch = criarBuscaSessaoHttp()): AutorizarPreview {
  return async req => {
    const cookies = (req.headers.cookie ?? "").split(";").map(item => item.trim());
    const correspondentes = cookies.filter(item => item.startsWith(`${COOKIE_HOMOLOGACAO}=`));
    if (correspondentes.length !== 1) return "login";
    const cookie = correspondentes[0];
    const token = cookie.slice(COOKIE_HOMOLOGACAO.length + 1);
    if (cookie.length > 4096 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return "login";
    try {
      const resposta = await buscar(ENDERECO_SESSAO, {
        method: "GET",
        headers: { Cookie: cookie, Host: HOST_PREVIEW },
        redirect: "manual",
        signal: AbortSignal.timeout(2500),
      });
      if (resposta.status === 401) return "login";
      if (resposta.status === 403) return "negado";
      if (resposta.status !== 200 || !resposta.headers.get("content-type")?.startsWith("application/json")) return "indisponivel";
      const leitor = resposta.body?.getReader();
      if (!leitor) return "indisponivel";
      let texto = "", bytes = 0;
      try {
        const partes: Uint8Array[] = [];
        for (;;) {
          const parte = await leitor.read();
          if (parte.done) break;
          bytes += parte.value.byteLength;
          if (bytes > 4096) { await leitor.cancel(); return "indisponivel"; }
          partes.push(parte.value);
        }
        texto = Buffer.concat(partes).toString("utf8");
      } finally { leitor.releaseLock(); }
      const dados: unknown = JSON.parse(texto);
      return dados && typeof dados === "object" && "somenteLeitura" in dados && dados.somenteLeitura === true
        ? "permitido" : "indisponivel";
    } catch { return "indisponivel"; }
  };
}
