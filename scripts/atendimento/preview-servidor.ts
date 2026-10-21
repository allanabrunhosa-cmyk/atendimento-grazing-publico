import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { criarAutorizadorPreview, HOST_PREVIEW, type AutorizarPreview } from "./preview-protecao";

export const ROTAS_PREVIEW = ["chat", "dashboard", "contacts", "pipeline", "scheduling", "team", "templates", "settings", "automations"] as const;
const paginas = new Set(["/preview", "/preview/", ...ROTAS_PREVIEW.map(tela => `/preview/${tela}`)]);
const mimes: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".gif": "image/gif", ".woff2": "font/woff2",
};

export const CSP_PREVIEW = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' data:; font-src 'self'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; worker-src 'none'";

function cabecalhos(res: ServerResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", CSP_PREVIEW);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function enviar(res: ServerResponse, codigo: number, erro: string, somenteCabecalho = false) {
  res.writeHead(codigo, { "Content-Type": "application/json; charset=utf-8" });
  res.end(somenteCabecalho ? undefined : JSON.stringify({ erro }));
}

/** Somente arquivos da release fictícia. Nenhuma rota de negócio, proxy ou configuração privada. */
export function criarServidorPreview(opcoes: { raiz: string; autorizar?: AutorizarPreview }) {
  const raiz = resolve(opcoes.raiz), autorizar = opcoes.autorizar ?? criarAutorizadorPreview();
  async function atender(req: IncomingMessage, res: ServerResponse) {
    cabecalhos(res);
    const somenteCabecalho = req.method === "HEAD";
    if (req.headers.host !== HOST_PREVIEW && req.headers.host !== "localhost:3000") return enviar(res, 421, "HOST_RECUSADO", somenteCabecalho);
    if (req.method !== "GET" && !somenteCabecalho) {
      res.setHeader("Allow", "GET, HEAD");
      return enviar(res, 405, "PREVIA_SEM_OPERACOES_REAIS");
    }
    const caminho = (req.url ?? "").split("?", 1)[0];
    // Conferir a entrada crua evita normalizações que esconderiam ../, barras ambíguas ou escapes.
    if (!caminho.startsWith("/") || /[\\%\x00-\x20#]/.test(caminho) || caminho.includes("//") || caminho.split("/").some(parte => parte === "." || parte === "..")) return enviar(res, 404, "ROTA_NAO_DISPONIVEL", somenteCabecalho);
    if (caminho === "/preview/saude") {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(somenteCabecalho ? undefined : JSON.stringify({ servico: "previa-interativa", dadosFicticios: true, enviosReais: false }));
    }
    const arquivoRelativo = paginas.has(caminho) ? "index.html"
      : /^\/preview\/assets\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:js|css|svg|png|jpe?g|webp|gif|woff2)$/.test(caminho)
        ? caminho.slice("/preview/".length) : null;
    if (!arquivoRelativo) return enviar(res, 404, "ROTA_NAO_DISPONIVEL", somenteCabecalho);
    const acesso = await autorizar(req);
    if (acesso === "login") { res.writeHead(303, { Location: "/" }); return res.end(); }
    if (acesso !== "permitido") return enviar(res, acesso === "negado" ? 403 : 503, acesso === "negado" ? "ACESSO_NAO_AUTORIZADO" : "CONFERENCIA_DE_ACESSO_INDISPONIVEL", somenteCabecalho);
    const arquivo = resolve(raiz, arquivoRelativo);
    const raizReal = await realpath(raiz);
    let arquivoReal: string;
    try { arquivoReal = await realpath(arquivo); } catch { return enviar(res, 404, "ARQUIVO_NAO_DISPONIVEL", somenteCabecalho); }
    if (!arquivoReal.startsWith(raizReal + sep)) return enviar(res, 404, "ARQUIVO_NAO_DISPONIVEL", somenteCabecalho);
    const info = await stat(arquivoReal);
    if (!info.isFile() || info.size > 20 * 1024 * 1024) return enviar(res, 404, "ARQUIVO_NAO_DISPONIVEL", somenteCabecalho);
    const bytes = somenteCabecalho ? undefined : await readFile(arquivoReal);
    res.writeHead(200, { "Content-Type": mimes[extname(arquivoReal)] ?? "application/octet-stream", "Content-Length": info.size });
    res.end(bytes);
  }
  return createServer((req, res) => {
    void atender(req, res).catch(() => {
      if (!res.headersSent) enviar(res, 503, "PREVIA_INDISPONIVEL", req.method === "HEAD");
      else res.destroy();
    });
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  criarServidorPreview({ raiz: "/preview/web" }).listen(3000, "0.0.0.0");
}
