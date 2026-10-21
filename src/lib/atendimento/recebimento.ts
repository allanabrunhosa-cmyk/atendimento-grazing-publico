import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { Recebimento } from "./webhook";

export async function persistirRecebimento(recebimento: Recebimento) {
  await prisma.$transaction(async tx => {
    const recibos = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO atendimento_migracao.recibo (id, hash, corpo)
      VALUES (${randomUUID()}::uuid, ${recebimento.hash}, ${recebimento.corpo})
      ON CONFLICT (hash) DO NOTHING RETURNING id`;
    if (!recibos.length) return;
    for (const evento of recebimento.eventos) {
      await tx.$executeRaw`
        INSERT INTO atendimento_migracao.evento (id, recibo_id, chave, tipo, waba, numero, conteudo)
        VALUES (${randomUUID()}::uuid, ${recibos[0].id}::uuid, ${evento.chave}, ${evento.tipo}, ${evento.waba}, ${evento.numero}, ${JSON.stringify(evento.conteudo)}::jsonb)
        ON CONFLICT (chave) DO NOTHING`;
    }
  }, { timeout: 30_000 });
}
export async function adquirirEvento() {
  const lease = randomUUID();
  const eventos = await prisma.$queryRaw<{ id: string; lease: string; conteudo: unknown; tipo: string; tentativas: number }[]>`
    WITH esgotados AS (
      UPDATE atendimento_migracao.evento SET estado = 'falho', ultimo_erro = 'LEASE_ESGOTADO', lease = NULL, lease_ate = NULL
      WHERE estado = 'processando' AND lease_ate < now() AND tentativas >= 8 RETURNING id
    ), candidato AS (
      SELECT id FROM atendimento_migracao.evento
      WHERE (estado = 'pendente' OR (estado = 'processando' AND lease_ate < now()))
        AND proxima_tentativa <= now() AND tentativas < 8
      ORDER BY recebido_em, id LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    UPDATE atendimento_migracao.evento e SET estado = 'processando', lease = ${lease}::uuid,
      lease_ate = now() + interval '2 minutes', tentativas = tentativas + 1
    FROM candidato WHERE e.id = candidato.id RETURNING e.id, e.lease, e.tipo, e.conteudo, e.tentativas`;
  return eventos[0] ?? null;
}
export async function concluirEvento(id: string, lease: string) {
  return (await prisma.$executeRaw`UPDATE atendimento_migracao.evento SET estado = 'concluido', lease = NULL, lease_ate = NULL, concluido_em = now()
    WHERE id = ${id}::uuid AND estado = 'processando' AND lease = ${lease}::uuid AND lease_ate >= now()`) === 1;
}
export async function falharEvento(id: string, lease: string, codigo: string) {
  if (!/^[A-Z0-9_]{1,80}$/.test(codigo)) throw new Error("Use somente código de erro, sem payload ou dados pessoais.");
  return (await prisma.$executeRaw`UPDATE atendimento_migracao.evento SET estado = CASE WHEN tentativas >= 8 THEN 'falho' ELSE 'pendente' END,
    proxima_tentativa = now() + make_interval(secs => least(3600, (power(2, tentativas) * 10)::int)),
    ultimo_erro = ${codigo}, lease = NULL, lease_ate = NULL
    WHERE id = ${id}::uuid AND estado = 'processando' AND lease = ${lease}::uuid AND lease_ate >= now()`) === 1;
}
