import "server-only";
import { prepararCarga, decodificarCarga, type DocumentoCarga, type CargaPreparada } from "./carga";

type Transacao = Extract<DocumentoCarga, { tipo: "transacao" }>;
export type ConfiguracaoColeta = { execucao: string; origem: string; credencial: string; tokenColetor?: string; capturaAprovada: boolean; simular: boolean };
type DestinosColeta = { arquivar: (carga: CargaPreparada) => Promise<void>; persistir: (carga: CargaPreparada) => Promise<unknown>; confirmada?: (carga: CargaPreparada) => Promise<void> };
type OpcoesColeta = { aposLeituraValidada?: (observacao: { transacoes: number; eventos: number; lidaEm: string; duracaoConsultaOrigemMs: number }) => Promise<void> };
export function criarOrigemColeta(config: ConfiguracaoColeta, requisitar: typeof fetch = fetch) {
  const url = new URL(config.origem);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.pathname !== "/" || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || !config.credencial || !config.capturaAprovada) throw new Error("COLETA_NAO_PREPARADA");
  if (config.tokenColetor && !/^[a-f0-9]{64}$/.test(config.tokenColetor)) throw new Error("COLETA_NAO_PREPARADA");
  return async (funcao: "ler_lote" | "confirmar" | "snapshot", parametros: Record<string, unknown>): Promise<unknown> => {
    if (funcao === "confirmar" && config.simular) throw new Error("CONFIRMACAO_DESLIGADA");
    let resposta: Response;
    try { resposta = await requisitar(new URL(`/rest/v1/rpc/donatella_migracao_${funcao}`,url), {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { apikey: config.credencial, ...(!config.tokenColetor ? { Authorization: `Bearer ${config.credencial}` } : { "x-donatella-coletor": config.tokenColetor }), "Content-Type": "application/json" }, body: JSON.stringify(parametros),
    }); } catch (falha) { throw falhaTransporte(falha,funcao); }
    if (!resposta.ok || !resposta.body) {
      const erro=new Error("ORIGEM_INDISPONIVEL") as Error & {http:number;rpc:string};
      erro.http=resposta.status;erro.rpc=funcao;throw erro;
    }
    const leitor = resposta.body.getReader(); const partes: Uint8Array[] = []; let tamanho = 0;
    try {
      while (true) {
        const parte = await leitor.read(); if (parte.done) break;
        tamanho += parte.value.byteLength;
        if (tamanho > 32 * 1024 * 1024) { await leitor.cancel(); throw new Error("LOTE_MUITO_GRANDE"); }
        partes.push(parte.value);
      }
    } catch (falha) {
      if(falha instanceof Error&&falha.message==='LOTE_MUITO_GRANDE')throw falha;
      throw falhaTransporte(falha,funcao);
    } finally { leitor.releaseLock(); }
    try { const texto=Buffer.concat(partes).toString("utf8"); return funcao==="confirmar" ? JSON.parse(texto) : decodificarCarga(texto); }
    catch { throw new Error("RESPOSTA_ORIGEM_INVALIDA"); }
  };
}
/** Mantém diagnóstico útil sem incorporar mensagem, URL, cabeçalhos ou corpo privados. */
function falhaTransporte(falha:unknown,rpc:string){
  const f=falha as {name?:unknown;cause?:{code?:unknown}}|null;
  const prazo=f?.name==='TimeoutError'||f?.name==='AbortError';
  const erro=new Error(prazo?'ORIGEM_PRAZO_EXCEDIDO':'ORIGEM_REDE_INDISPONIVEL') as Error & {rpc:string;code?:string};
  erro.rpc=rpc;
  if(prazo)erro.code='TIMEOUT';
  else if(typeof f?.cause?.code==='string'&&/^[A-Z0-9_]{2,32}$/.test(f.cause.code))erro.code=f.cause.code;
  return erro;
}
export async function coletarLote(config: ConfiguracaoColeta, destinos: DestinosColeta, requisitar: typeof fetch = fetch, opcoes: OpcoesColeta = {}) {
  const origem = criarOrigemColeta(config,requisitar);
  const inicioConsulta = Date.now();
  const lote = await origem("ler_lote", { limite: 20 });
  const duracaoConsultaOrigemMs = Date.now() - inicioConsulta, lidaEm = new Date().toISOString();
  if (!Array.isArray(lote) || lote.length > 20) throw new Error("LOTE_INVALIDO");
  // Validar todo o lote antes de confirmar qualquer grupo; não usa watermark.
  const cargas = lote.map((t: { id: string; eventos: Transacao["eventos"] }) => prepararCarga({ execucao: config.execucao,id: t.id,tipo: "transacao",eventos: t.eventos }));
  const eventos = cargas.reduce((n,c)=>n+(c.documento as Transacao).eventos.length,0);
  // O supervisor mede e retoma o diário usando esta leitura, sem reler a origem.
  // Nenhum payload é entregue ao observador; toda a página já foi validada.
  if (!config.simular) await opcoes.aposLeituraValidada?.({ transacoes: cargas.length, eventos, lidaEm, duracaoConsultaOrigemMs });
  let confirmadas = 0;
  for (const carga of cargas) {
    if (config.simular) continue;
    await destinos.arquivar(carga);
    await destinos.persistir(carga);
    const quantidade = await origem("confirmar", { ids: [carga.documento.id] });
    if (quantidade !== 0 && quantidade !== 1) throw new Error("CONFIRMACAO_INVALIDA");
    // O registro anterior ao ACK permite retomar inclusive resposta perdida/queda
    // após confirmação na origem. Falha deste callback permanece explícita.
    await destinos.confirmada?.(carga);
    confirmadas++;
  }
  return { simulacao: config.simular, transacoes: cargas.length, eventos, confirmadas };
}
export async function coletarPagina(config: ConfiguracaoColeta, schema: string, tabela: string, apos: Record<string,unknown>|null, destinos: DestinosColeta, id: string, requisitar: typeof fetch = fetch) {
  const origem = criarOrigemColeta(config,requisitar);
  const pagina = await origem("snapshot", { esquema: schema,tabela,apos,limite: 500 });
  if (!pagina || typeof pagina !== "object" || Array.isArray(pagina)) throw new Error("PAGINA_INVALIDA");
  const carga = prepararCarga({ ...pagina,execucao: config.execucao,id,tipo: "snapshot" } as DocumentoCarga);
  if (carga.documento.tipo !== "snapshot" || carga.documento.schema !== schema || carga.documento.tabela !== tabela) throw new Error("PAGINA_INVALIDA");
  if (!config.simular) { await destinos.arquivar(carga); await destinos.persistir(carga); }
  return { registros: carga.documento.registros.length, proxima: carga.documento.proxima, fim: carga.documento.fim };
}
/** Rodada limitada; uma fila vazia neste instante não é monitoramento permanente. */
export async function drenarColeta(config:ConfiguracaoColeta,destinos:DestinosColeta,maxRodadas:number,requisitar:typeof fetch=fetch) {
  if(config.simular||!Number.isInteger(maxRodadas)||maxRodadas<1||maxRodadas>20)throw new Error("DRENAGEM_NAO_AUTORIZADA");
  let transacoes=0,eventos=0,confirmadas=0;
  for(let rodada=1;rodada<=maxRodadas;rodada++){
    const lote=await coletarLote(config,destinos,requisitar);
    transacoes+=lote.transacoes;eventos+=lote.eventos;confirmadas+=lote.confirmadas;
    if(lote.transacoes===0)return{rodadas:rodada,transacoes,eventos,confirmadas,pendentesNaUltimaLeitura:false};
  }
  return{rodadas:maxRodadas,transacoes,eventos,confirmadas,pendentesNaUltimaLeitura:null};
}
