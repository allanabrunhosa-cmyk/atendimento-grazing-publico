import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { open, realpath, type FileHandle } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { criarAutorizadorPreview, HOST_PREVIEW, type AutorizarPreview, type ResultadoAutorizacaoPreview } from "./preview-protecao";

export const ROTAS_CONSULTA_CHAT = ["chat", "contatos"] as const;
export const CSP_CONSULTA_CHAT = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self'; font-src 'self'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; worker-src 'none'";
const paginas = new Set(["/consulta", "/consulta/", ...ROTAS_CONSULTA_CHAT.map(tela => `/consulta/${tela}`)]);
const mimes: Record<string, string> = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".woff2": "font/woff2",
};
const LIMITE_ARQUIVO = 8 * 1024 * 1024;

function cabecalhos(res: ServerResponse) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Security-Policy", CSP_CONSULTA_CHAT);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

function enviar(res: ServerResponse, codigo: number, erro: string, head = false) {
  res.writeHead(codigo, { "Content-Type": "application/json; charset=utf-8" });
  res.end(head ? undefined : JSON.stringify({ erro }));
}

function recusarAcesso(res: ServerResponse, acesso: ResultadoAutorizacaoPreview, head: boolean) {
  if (acesso === "permitido") return false;
  if (acesso === "login") { res.writeHead(303, { Location: "/" }); res.end(); }
  else enviar(res, acesso === "negado" ? 403 : 503, acesso === "negado" ? "ACESSO_NAO_AUTORIZADO" : "CONFERENCIA_DE_ACESSO_INDISPONIVEL", head);
  return true;
}

/** Leitura limitada mesmo se o arquivo crescer depois da conferência de tamanho. */
async function lerRelease(arquivo: FileHandle, tamanho: number) {
  const bytes = Buffer.alloc(tamanho + 1);
  let lidos = 0;
  while (lidos < bytes.length) {
    const parte = await arquivo.read(bytes, lidos, bytes.length - lidos, lidos);
    if (parte.bytesRead === 0) break;
    lidos += parte.bytesRead;
  }
  if (lidos !== tamanho) throw Error("RELEASE_ALTERADA_DURANTE_LEITURA");
  return bytes.subarray(0, lidos);
}

/** Serve somente a interface da consulta; APIs, dados e anexos pertencem ao serviço existente. */
export function criarServidorConsultaChat(opcoes: { raiz: string; autorizar?: AutorizarPreview; limiteConcorrencia?: number }) {
  const raiz = resolve(opcoes.raiz), autorizar = opcoes.autorizar ?? criarAutorizadorPreview();
  const limite = opcoes.limiteConcorrencia ?? 8;
  if (!Number.isSafeInteger(limite) || limite < 1 || limite > 8) throw Error("CONSULTA_LIMITE_INVALIDO");
  let ativos = 0;
  async function atender(req: IncomingMessage, res: ServerResponse) {
    const head = req.method === "HEAD", caminho = (req.url ?? "").split("?", 1)[0];
    const saude = caminho === "/consulta/saude";
    if (req.headers.host !== HOST_PREVIEW && !(saude && req.headers.host === "localhost:3000")) return enviar(res, 421, "HOST_RECUSADO", head);
    if (req.method !== "GET" && !head) {
      req.resume(); res.setHeader("Allow", "GET, HEAD");
      return enviar(res, 405, "CONSULTA_SOMENTE_LEITURA");
    }
    // Entrada crua: normalizar antes da allowlist ocultaria travessias e escapes ambíguos.
    if ((req.url ?? "").length > 2048 || !caminho.startsWith("/") || /[\\%\x00-\x20#]/.test(caminho) || caminho.includes("//") || caminho.split("/").some(parte => parte === "." || parte === "..")) return enviar(res, 404, "ROTA_NAO_DISPONIVEL", head);
    if (saude) {
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(head ? undefined : JSON.stringify({ servico: "interface-consulta", somenteLeitura: true, enviosReais: false }));
    }
    const relativo = paginas.has(caminho) ? "index.html"
      : /^\/consulta\/assets\/[A-Za-z0-9][A-Za-z0-9_.-]{0,159}\.(?:js|css|svg|woff2)$/.test(caminho)
        ? caminho.slice("/consulta/".length) : null;
    if (!relativo) return enviar(res, 404, "ROTA_NAO_DISPONIVEL", head);
    if (recusarAcesso(res, await autorizar(req), head)) return;
    const raizReal = await realpath(raiz);
    let caminhoReal: string;
    try { caminhoReal = await realpath(resolve(raizReal, relativo)); }
    catch { return enviar(res, 404, "ARQUIVO_NAO_DISPONIVEL", head); }
    if (!caminhoReal.startsWith(raizReal + sep) || extname(caminhoReal) !== extname(relativo)) return enviar(res, 404, "ARQUIVO_NAO_DISPONIVEL", head);
    let arquivo: FileHandle;
    try { arquivo = await open(caminhoReal, "r"); }
    catch { return enviar(res, 404, "ARQUIVO_NAO_DISPONIVEL", head); }
    try {
      const info = await arquivo.stat();
      if (!info.isFile() || info.size > LIMITE_ARQUIVO) return enviar(res, 404, "ARQUIVO_NAO_DISPONIVEL", head);
      const bytes = head ? undefined : await lerRelease(arquivo, info.size);
      // A sessão pode ter sido revogada enquanto o disco entregava a release.
      if (recusarAcesso(res, await autorizar(req), head)) return;
      res.writeHead(200, { "Content-Type": mimes[extname(caminhoReal)], "Content-Length": info.size });
      res.end(bytes);
    } finally { await arquivo.close(); }
  }
  const servidor = createServer({ maxHeaderSize: 8192 }, (req, res) => {
    cabecalhos(res);
    if (ativos >= limite) {
      req.resume(); res.setHeader("Retry-After", "2");
      return enviar(res, 503, "CONSULTA_CONCORRENCIA_EXCEDIDA", req.method === "HEAD");
    }
    ativos++;
    void atender(req, res).catch(() => {
      if (!res.headersSent) enviar(res, 503, "CONSULTA_INDISPONIVEL", req.method === "HEAD");
      else res.destroy();
    }).finally(() => { ativos--; });
  });
  servidor.requestTimeout = 15000; servidor.headersTimeout = 10000; servidor.maxRequestsPerSocket = 100;
  return servidor;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  criarServidorConsultaChat({ raiz: "/chat-consulta/web" }).listen(3000, "0.0.0.0");
}
