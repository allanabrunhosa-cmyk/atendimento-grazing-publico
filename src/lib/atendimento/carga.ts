import "server-only";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { cifrar, decifrar } from "@/lib/crypto";

const tabelas = new Set([
  "appointments", "automation_executions", "automation_logs", "automation_rules", "automation_scheduled", "contact_cooldowns",
  "contacts", "conversation_activities", "conversation_states", "conversations", "deal_activities", "deals", "message_grouping_queue",
  "message_processing_queue", "messages", "nina_processing_queue", "nina_settings", "notifications", "orders", "pipeline_stages",
  "product_catalog_audit", "profiles", "send_queue", "support_cases", "system_settings", "tag_definitions", "team_business_hours",
  "team_functions", "team_holidays", "team_members", "teams", "user_roles", "webhook_events", "whatsapp_templates",
]);
type Registro = Record<string, unknown>;
type Linha = { chave: Registro; dados: Registro };
type Evento = { sequencia: string; schema: string; tabela: string; operacao: "INSERT" | "UPDATE" | "DELETE"; chave_anterior: Registro | null; chave_posterior: Registro | null; anterior: Registro | null; posterior: Registro | null };
export type DocumentoCarga =
  | { execucao: string; id: string; tipo: "snapshot"; schema: string; tabela: string; registros: Linha[]; proxima: Registro | null; fim: boolean }
  | { execucao: string; id: string; tipo: "transacao"; eventos: Evento[] };
type Estado = { schema: string; tabela: string; chaveHash: string; sequencia: string; excluido: boolean; indice: number };
export type CargaPreparada = { documento: DocumentoCarga; hash: string; cifrado: string; estados: Estado[] };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const objeto = (valor: unknown): valor is Registro => valor !== null && typeof valor === "object" && !Array.isArray(valor);
type JsonComFonte = {rawJSON:(texto:string)=>unknown;isRawJSON:(valor:unknown)=>boolean;parse:(texto:string,reviver:(chave:string,valor:unknown,contexto:{source?:string})=>unknown)=>unknown};
const jsonComFonte=JSON as unknown as JsonComFonte;
export function decodificarCarga(texto:string): unknown {
  if (typeof jsonComFonte.rawJSON!=="function" || typeof jsonComFonte.isRawJSON!=="function") throw new Error("Carga exige Node 22 com preservação da precisão JSON");
  return jsonComFonte.parse(texto,(_chave,valor,contexto)=>typeof valor==="number" ? jsonComFonte.rawJSON(contexto.source!) : valor);
}
export function serializarCarga(valor: unknown): string {
  if (jsonComFonte.isRawJSON?.(valor)) return JSON.stringify(valor);
  if (Array.isArray(valor)) return `[${valor.map(serializarCarga).join(",")}]`;
  if (objeto(valor)) return `{${Object.keys(valor).sort().map(k => `${JSON.stringify(k)}:${serializarCarga(valor[k])}`).join(",")}}`;
  if (valor === undefined || (typeof valor === "number" && !Number.isFinite(valor))) throw new Error("Valor de carga inválido");
  return JSON.stringify(valor);
}
const hash = (valor: string) => createHash("sha256").update(valor).digest("hex");
function conferirAlvo(schema: string, tabela: string) {
  if (!(schema === "public" && tabelas.has(tabela)) && !(schema === "storage" && ["objects", "buckets"].includes(tabela)) && !(schema === "auth" && tabela === "users")) throw new Error("Tabela de carga não autorizada");
}
function conferirLinha(schema: string, tabela: string, chave: Registro, dados: Registro | null) {
  if (!objeto(chave)) throw new Error("Chave de carga inválida");
  const pk = tabela === "contact_cooldowns" ? ["contact_phone", "rule_id"] : ["id"];
  if (Object.keys(chave).length !== pk.length || pk.some(c => typeof chave[c] !== "string" || (chave[c] as string).length === 0 || (chave[c] as string).length > 512)) throw new Error("Chave de carga inválida");
  if (dados !== null && (!objeto(dados) || pk.some(c => chave[c] !== dados[c]))) throw new Error("Dados não correspondem à chave");
  if (schema === "auth" && dados && Object.keys(dados).some(c => !["id", "email", "created_at", "updated_at", "deleted_at", "banned_until"].includes(c))) throw new Error("Credencial legada não permitida");
}
function analisarDocumento(documento: DocumentoCarga): Estado[] {
  if (!uuid.test(documento.execucao) || !uuid.test(documento.id)) throw new Error("Identificador de carga inválido");
  const estados: Estado[] = [];
  if (documento.tipo === "snapshot") {
    conferirAlvo(documento.schema, documento.tabela);
    if (!Array.isArray(documento.registros) || documento.registros.length > 1000 || typeof documento.fim !== "boolean") throw new Error("Página de carga inválida");
    documento.registros.forEach((r, indice) => {
      conferirLinha(documento.schema, documento.tabela, r.chave, r.dados);
      estados.push({ schema: documento.schema, tabela: documento.tabela, chaveHash: hash(serializarCarga(r.chave)), sequencia: "0", excluido: false, indice });
    });
  } else if (documento.tipo === "transacao") {
    if (!Array.isArray(documento.eventos) || !documento.eventos.length) throw new Error("Transação vazia");
    let anterior = BigInt(0);
    documento.eventos.forEach((e, indice) => {
      conferirAlvo(e.schema, e.tabela);
      if (!/^[1-9]\d{0,18}$/.test(e.sequencia) || BigInt(e.sequencia) > BigInt("9223372036854775807") || BigInt(e.sequencia) <= anterior) throw new Error("Sequência inválida");
      anterior = BigInt(e.sequencia);
      if (!["INSERT", "UPDATE", "DELETE"].includes(e.operacao) || (e.operacao === "INSERT" ? e.chave_anterior !== null || e.anterior !== null : !e.chave_anterior || !e.anterior) || (e.operacao === "DELETE" ? e.chave_posterior !== null || e.posterior !== null : !e.chave_posterior || !e.posterior)) throw new Error("Evento inválido");
      if (e.chave_anterior) conferirLinha(e.schema, e.tabela, e.chave_anterior, e.anterior);
      if (e.chave_posterior) conferirLinha(e.schema, e.tabela, e.chave_posterior, e.posterior);
      if (e.chave_anterior && (!e.chave_posterior || serializarCarga(e.chave_anterior) !== serializarCarga(e.chave_posterior))) estados.push({ schema: e.schema, tabela: e.tabela, chaveHash: hash(serializarCarga(e.chave_anterior)), sequencia: e.sequencia, excluido: true, indice });
      if (e.chave_posterior) estados.push({ schema: e.schema, tabela: e.tabela, chaveHash: hash(serializarCarga(e.chave_posterior)), sequencia: e.sequencia, excluido: false, indice });
    });
  } else throw new Error("Tipo de carga inválido");
  // Último estado por chave, travas em ordem estável; sequência é fence por registro,
  // nunca watermark de confirmação global. A origem continua entregando grupos completos.
  const finais = new Map<string, Estado>();
  for (const e of estados) finais.set(`${e.schema}/${e.tabela}/${e.chaveHash}`, e);
  return [...finais.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([,e]) => e);
}
export function prepararCarga(documento: DocumentoCarga): CargaPreparada {
  const estados = analisarDocumento(documento);
  const texto = serializarCarga(documento);
  if (Buffer.byteLength(texto) > 32 * 1024 * 1024) throw new Error("Transação exige canal para volume maior; não dividir nem confirmar parcialmente");
  return { documento, estados, hash: hash(texto), cifrado: cifrar(texto, "grazing-atendimento-carga-v2",process.env.ATENDIMENTO_CARGA_SECRET || undefined) };
}
export function abrirCarga(cifrado: string, hashEsperado: string): DocumentoCarga {
  const texto = decifrar(cifrado, "grazing-atendimento-carga-v2",process.env.ATENDIMENTO_CARGA_SECRET || undefined);
  if (hash(texto) !== hashEsperado) throw new Error("Arquivo de carga divergente");
  const documento = decodificarCarga(texto) as DocumentoCarga;
  analisarDocumento(documento);
  return documento;
}
/** Conferência de integridade/índices, sem recifrar ou retornar os dados financeiros.
 * O SHA verifica os bytes originais antes de interpretar somente chaves/metadados.
 * Importação/replay continuam usando abrirCarga com precisão JSON preservada.
 */
export function conferirIndicesCifrados(cifrado:string,hashEsperado:string) {
  const texto=decifrar(cifrado,"grazing-atendimento-carga-v2",process.env.ATENDIMENTO_CARGA_SECRET||undefined);
  if(hash(texto)!==hashEsperado)throw new Error("Arquivo de carga divergente");
  const documento=JSON.parse(texto) as DocumentoCarga;
  return {id:documento.id,execucao:documento.execucao,tipo:documento.tipo,estados:analisarDocumento(documento),
    quantidade:documento.tipo==="snapshot"?documento.registros.length:documento.eventos.length};
}
export async function persistirCarga(carga: CargaPreparada) {
  // Revalidar impede estados/hash fabricados por um chamador local.
  const estados = analisarDocumento(carga.documento);
  if (hash(serializarCarga(carga.documento)) !== carga.hash || serializarCarga(abrirCarga(carga.cifrado,carga.hash)) !== serializarCarga(carga.documento)) throw new Error("Carga divergente");
  return prisma.$transaction(async tx => {
    const inseridos = await tx.$queryRaw<{ id: string }[]>`INSERT INTO atendimento_migracao.carga_documento(execucao,id,tipo,hash,cifrado)
      VALUES (${carga.documento.execucao}::uuid,${carga.documento.id}::uuid,${carga.documento.tipo},${carga.hash},${carga.cifrado})
      ON CONFLICT(execucao,id) DO NOTHING RETURNING id`;
    if (!inseridos.length) {
      const anterior = await tx.$queryRaw<{ hash: string }[]>`SELECT hash FROM atendimento_migracao.carga_documento WHERE execucao=${carga.documento.execucao}::uuid AND id=${carga.documento.id}::uuid`;
      if (anterior[0]?.hash !== carga.hash) throw new Error("Identificador já usado por carga divergente");
      return { repetida: true, registros: 0 };
    }
    // Uma ida ao banco por grupo, mantendo a mesma transação/fence. O JSON contém
    // apenas metadados de índice/hash, nunca payload de clientes ou segredos.
    const indice = JSON.stringify(estados);
    const registros = await tx.$executeRaw`INSERT INTO atendimento_migracao.carga_registro(execucao,schema_name,table_name,chave_hash,sequencia,excluido,documento_id,indice)
      SELECT ${carga.documento.execucao}::uuid,e.schema,e.tabela,e."chaveHash",e.sequencia::bigint,e.excluido,${carga.documento.id}::uuid,e.indice
      FROM jsonb_to_recordset(${indice}::jsonb) AS e(schema text,tabela text,"chaveHash" text,sequencia text,excluido boolean,indice integer)
      ORDER BY e.schema COLLATE "C",e.tabela COLLATE "C",e."chaveHash" COLLATE "C"
      ON CONFLICT(execucao,schema_name,table_name,chave_hash) DO UPDATE SET sequencia=excluded.sequencia,excluido=excluded.excluido,documento_id=excluded.documento_id,indice=excluded.indice
      WHERE atendimento_migracao.carga_registro.sequencia < excluded.sequencia`;
    if (estados.some(e=>e.sequencia!=="0")) {
      const colisao=await tx.$queryRaw<{ documento_id:string }[]>`SELECT r.documento_id
        FROM atendimento_migracao.carga_registro r
        JOIN jsonb_to_recordset(${indice}::jsonb) AS e(schema text,tabela text,"chaveHash" text,sequencia text)
          ON r.schema_name=e.schema AND r.table_name=e.tabela AND r.chave_hash=e."chaveHash"
        WHERE r.execucao=${carga.documento.execucao}::uuid AND e.sequencia<>'0'
          AND r.sequencia=e.sequencia::bigint AND r.documento_id<>${carga.documento.id}::uuid LIMIT 1`;
      if (colisao.length) throw new Error("Sequência já usada por transação divergente");
    }
    return { repetida: false, registros };
  }, { timeout: 60_000 });
}
