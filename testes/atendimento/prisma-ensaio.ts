import { Pool, type PoolClient } from "pg";
const url = new URL(process.env.ATENDIMENTO_BANCO_ENSAIO ?? "http://invalido.invalid");
if (process.env.ATENDIMENTO_ENSAIO !== "1" || url.hostname !== "127.0.0.1" || url.pathname !== "/donatella_ensaio") throw new Error("Ensaio exige banco explicitamente isolado e sem dados reais.");
export const poolEnsaio = new Pool({ connectionString: url.toString(), max: 6 });
function adaptar(cliente: Pick<PoolClient, "query">) {
  const executar = (strings: TemplateStringsArray, valores: unknown[]) => cliente.query(strings.map((s,i) => s + (i < valores.length ? `$${i+1}` : "")).join(""), valores);
  return {
    $queryRaw: async <T>(strings: TemplateStringsArray, ...valores: unknown[]): Promise<T> => (await executar(strings,valores)).rows as T,
    $executeRaw: async (strings: TemplateStringsArray, ...valores: unknown[]) => (await executar(strings,valores)).rowCount ?? 0,
  };
}
export const prisma = {
  ...adaptar(poolEnsaio),
  $transaction: async <T>(acao: (tx: ReturnType<typeof adaptar>) => Promise<T>) => {
    const cliente = await poolEnsaio.connect();
    try { await cliente.query("BEGIN"); const resultado = await acao(adaptar(cliente)); await cliente.query("COMMIT"); return resultado; }
    catch (erro) { await cliente.query("ROLLBACK"); throw erro; }
    finally { cliente.release(); }
  },
};
