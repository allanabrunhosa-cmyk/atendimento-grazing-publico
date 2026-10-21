import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { criarAutorizadorPreview, HOST_PREVIEW, type AutorizarPreview } from "./preview-protecao";
import { ServicoLaboratorio, EMPRESA_LAB } from "./laboratorio-servico";
import type { TemaIA } from "../../src/lib/atendimento/ia-orquestrador";

export const CSP_LABORATORIO = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'none'; font-src 'self'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; worker-src 'none'";
const paginas = new Set(["/laboratorio", "/laboratorio/", "/laboratorio/chat", "/laboratorio/duvidas"]);
const arquivos = new Map([["/laboratorio/assets/lab.js", ["lab.js", "text/javascript; charset=utf-8"]], ["/laboratorio/assets/lab.css", ["lab.css", "text/css; charset=utf-8"]]]);
const operacoes = new Set(["mensagem", "retomar", "contexto", "responder", "preparar", "sugerir", "revisar"]);
function enviar(res: ServerResponse, status: number, dados: unknown, head = false) { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); res.end(head ? undefined : JSON.stringify(dados)); }
function campo(p: Record<string, unknown>, nome: string, max: number) { const s = p[nome]; if (typeof s !== "string" || !s.trim() || s.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(s)) throw Error("LAB_ENTRADA_INVALIDA"); return s; }
function numero(p: Record<string, unknown>, nome: string) { const n = p[nome]; if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 1) throw Error("LAB_ENTRADA_INVALIDA"); return n; }
function booleano(p: Record<string, unknown>, nome: string) { if (typeof p[nome] !== "boolean") throw Error("LAB_ENTRADA_INVALIDA"); return p[nome] as boolean; }
function chaves(p: Record<string, unknown>, nomes: string[]) { if (Object.keys(p).some(k => !nomes.includes(k)) || nomes.some(k => !(k in p))) throw Error("LAB_ENTRADA_INVALIDA"); }
async function corpo(req: IncomingMessage) {
  if (req.headers["content-type"] !== "application/json" || req.headers["x-donatella-laboratorio"] !== "ficticio") throw Error("LAB_TIPO_RECUSADO");
  const tamanho = req.headers["content-length"];
  if (tamanho !== undefined && (!/^\d+$/.test(tamanho) || Number(tamanho) > 8192)) throw Error("LAB_CORPO_EXCESSIVO");
  let bytes = 0; const partes: Buffer[] = [];
  for await (const parte of req) { const b = Buffer.from(parte); bytes += b.length; if (bytes > 8192) throw Error("LAB_CORPO_EXCESSIVO"); partes.push(b); }
  let p: unknown; try { p = JSON.parse(Buffer.concat(partes).toString("utf8")); } catch { throw Error("LAB_ENTRADA_INVALIDA"); }
  if (!p || typeof p !== "object" || Array.isArray(p)) throw Error("LAB_ENTRADA_INVALIDA");
  return p as Record<string, unknown>;
}

export function criarServidorLaboratorio(o: { web: string; servico: ServicoLaboratorio; autorizar?: AutorizarPreview; limiteConcorrencia?: number; limiteMutacoesPorMinuto?: number }) {
  const autorizar = o.autorizar ?? criarAutorizadorPreview();
  const concorrencia = o.limiteConcorrencia ?? 4, limiteMutacoes = o.limiteMutacoesPorMinuto ?? 30;
  if (!Number.isSafeInteger(concorrencia) || concorrencia < 1 || concorrencia > 4 || !Number.isSafeInteger(limiteMutacoes) || limiteMutacoes < 1 || limiteMutacoes > 60) throw Error("LAB_LIMITES_INVALIDOS");
  let ativos = 0, janela = Date.now(), mutacoes = 0;
  async function atender(req: IncomingMessage, res: ServerResponse) {
    const head = req.method === "HEAD", caminho = (req.url ?? "").split("?", 1)[0];
    res.setHeader("Cache-Control", "no-store"); res.setHeader("Content-Security-Policy", CSP_LABORATORIO);
    res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY"); res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    if (caminho === "/laboratorio/saude" && [HOST_PREVIEW, "localhost:3000"].includes(req.headers.host ?? "") && (req.method === "GET" || head)) return enviar(res, 200, { servico: "laboratorio-ficticio", enviosReais: false }, head);
    if (req.headers.host !== HOST_PREVIEW) return enviar(res, 421, { erro: "HOST_RECUSADO" }, head);
    if (!caminho.startsWith("/") || /[\\%\x00-\x20#]/.test(caminho) || caminho.includes("//") || caminho.split("/").some(p => p === "." || p === "..")) return enviar(res, 404, { erro: "ROTA_RECUSADA" }, head);
    const operacao = caminho.startsWith("/laboratorio/api/") ? caminho.slice("/laboratorio/api/".length) : null;
    if (!paginas.has(caminho) && !arquivos.has(caminho) && operacao !== "estado" && !operacoes.has(operacao ?? "")) return enviar(res, 404, { erro: "ROTA_RECUSADA" }, head);
    const acesso = await autorizar(req);
    if (acesso === "login") { if (operacao) return enviar(res, 401, { erro: "LOGIN_NECESSARIO" }, head); res.writeHead(303, { Location: "/" }); return res.end(); }
    if (acesso !== "permitido") return enviar(res, acesso === "negado" ? 403 : 503, { erro: "CONFERENCIA_DE_ACESSO_RECUSADA" }, head);
    const revalidar = async () => await autorizar(req) === "permitido";
    if (operacao === "estado" && req.method === "GET") return enviar(res, 200, await o.servico.estado(revalidar));
    if (operacao && operacoes.has(operacao) && req.method === "POST") {
      if (req.headers.origin !== `https://${HOST_PREVIEW}`) return enviar(res, 403, { erro: "ORIGEM_RECUSADA" });
      if (Date.now() - janela >= 60000) { janela = Date.now(); mutacoes = 0; }
      if (mutacoes >= limiteMutacoes) { res.setHeader("Retry-After", "60"); return enviar(res, 429, { erro: "LAB_TAXA_EXCEDIDA" }); }
      mutacoes++;
      const p = await corpo(req); let resultado: unknown;
      if (operacao === "mensagem") { chaves(p, ["id", "conversaId", "pergunta", "tema"]); resultado = await o.servico.receber({ id: campo(p, "id", 85), conversaId: campo(p, "conversaId", 100), pergunta: campo(p, "pergunta", 2000), tema: campo(p, "tema", 30) as TemaIA }, revalidar); }
      if (operacao === "retomar") { chaves(p, ["id"]); resultado = await o.servico.retomar(campo(p, "id", 85), revalidar); }
      if (operacao === "contexto") { chaves(p, ["conversaId", "versao", "estado", "modo"]); resultado = await o.servico.contexto({ empresaId: EMPRESA_LAB, conversaId: campo(p, "conversaId", 100), versao: numero(p, "versao"), estado: campo(p, "estado", 20) as "ia" | "humano" | "encerrada", modo: campo(p, "modo", 20) as "simulacao" | "rascunho" }, revalidar); }
      if (operacao === "responder") { chaves(p, ["casoId", "revisao", "mensagemId", "texto"]); resultado = await o.servico.responder({ casoId: campo(p, "casoId", 40), revisao: numero(p, "revisao"), mensagemId: campo(p, "mensagemId", 100), texto: campo(p, "texto", 2000) }, revalidar); }
      if (operacao === "preparar") { chaves(p, ["casoId", "revisao", "textoCliente", "revisaoHumana"]); resultado = await o.servico.preparar({ casoId: campo(p, "casoId", 40), revisao: numero(p, "revisao"), textoCliente: campo(p, "textoCliente", 2000), revisaoHumana: booleano(p, "revisaoHumana") }, revalidar); }
      if (operacao === "sugerir") { chaves(p, ["casoId", "pergunta", "resposta"]); resultado = await o.servico.sugerir({ casoId: campo(p, "casoId", 40), pergunta: campo(p, "pergunta", 2000), resposta: campo(p, "resposta", 2000) }, revalidar); }
      if (operacao === "revisar") { chaves(p, ["id", "revisao", "decisao", "motivo", "minimizacaoRevisada", "conflitosResolvidos"]); resultado = await o.servico.revisar({ id: campo(p, "id", 40), revisao: numero(p, "revisao"), decisao: campo(p, "decisao", 10) as "aprovar" | "rejeitar", motivo: campo(p, "motivo", 500), minimizacaoRevisada: booleano(p, "minimizacaoRevisada"), conflitosResolvidos: booleano(p, "conflitosResolvidos") }, revalidar); }
      if (!await revalidar()) throw Error("LAB_ACESSO_NEGADO");
      return enviar(res, 200, resultado);
    }
    if (operacao || req.method !== "GET" && !head) { res.setHeader("Allow", operacoes.has(operacao ?? "") ? "POST" : "GET, HEAD"); return enviar(res, 405, { erro: "OPERACAO_RECUSADA" }, head); }
    const [nome, mime] = arquivos.get(caminho) ?? ["index.html", "text/html; charset=utf-8"];
    const raiz = await realpath(resolve(o.web)); let arquivo: string;
    try { arquivo = await realpath(resolve(raiz, nome)); } catch { return enviar(res, 404, { erro: "ARQUIVO_AUSENTE" }, head); }
    const info = await stat(arquivo);
    if (!arquivo.startsWith(raiz + sep) || !info.isFile() || info.size > 1024 * 1024) return enviar(res, 404, { erro: "ARQUIVO_RECUSADO" }, head);
    if (!await revalidar()) throw Error("LAB_ACESSO_NEGADO");
    res.writeHead(200, { "Content-Type": mime, "Content-Length": info.size }); res.end(head ? undefined : await readFile(arquivo));
  }
  const servidor = createServer((req, res) => {
    if (ativos >= concorrencia) { req.resume(); res.setHeader("Cache-Control", "no-store"); res.setHeader("Retry-After", "2"); enviar(res, 503, { erro: "LAB_CONCORRENCIA_EXCEDIDA" }, req.method === "HEAD"); return; }
    ativos++;
    void atender(req, res).catch(erro => {
    if (res.headersSent) return res.destroy();
    const c = erro instanceof Error && /^[A-Z_]{1,80}$/.test(erro.message) ? erro.message : "LAB_INDISPONIVEL";
    const status = c.includes("ACESSO") ? 403 : c.includes("CONFLIT") || c.includes("REUTILIZ") || c.includes("CONTEXTO_ALTERADO") || c.includes("PREPARACAO_RECUSADA") ? 409 : c.includes("CORPO_EXCESSIVO") ? 413 : c.includes("INVALID") || c.includes("RECUSAD") || c.includes("AUSENTE") || c.includes("DADOS_PESSOAIS") ? 400 : 503;
    enviar(res, status, { erro: c }, req.method === "HEAD");
    }).finally(() => { ativos--; });
  });
  servidor.requestTimeout = 15000; servidor.headersTimeout = 10000; servidor.maxRequestsPerSocket = 100;
  return servidor;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const servico = new ServicoLaboratorio("/estado");
  await servico.iniciar();
  criarServidorLaboratorio({ web: "/laboratorio/web", servico }).listen(3000, "0.0.0.0");
}
