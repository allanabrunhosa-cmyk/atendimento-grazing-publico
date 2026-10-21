import 'server-only';
import type { Pool, PoolClient } from 'pg';
import type { AuditoriaDuvidas, ColecaoDuvidas, DocumentoDuvidas, RepositorioDuvidas, TransacaoDuvidas } from './duvidas-aprendizagem';

const tabelas: Record<ColecaoDuvidas, string> = { casos: 'casos', respostas: 'respostas', candidatos: 'candidatos' };
const campos = new Set(['codigo', 'dedupe', 'fingerprint']);
/** Somente banco dedicado. Não aceita o banco operacional do HUB. Identidades
 * são revalidadas pelo serviço usando tx.conexao, nunca um grant copiado da origem.
 * Transações curtas serializam um tenant; não há chamada de rede dentro do lock.
 * Cada revisão completa é preservada separadamente para auditoria/restauração.
 */
export function criarRepositorioDuvidasPg(pool: Pool): RepositorioDuvidas {
  return {
    async transacao<T>(empresaId: string, executar: (tx: TransacaoDuvidas) => Promise<T>) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/.test(empresaId)) throw Error('DUVIDAS_ID_INVALIDO');
      const cliente: PoolClient = await pool.connect();
      try {
        await cliente.query('BEGIN');
        await cliente.query("SET LOCAL lock_timeout='3s'; SET LOCAL statement_timeout='8s'");
        const banco = await cliente.query<{ nome: string }>('SELECT current_database() AS nome');
        if (!['donatella_operacao', 'donatella_ensaio_duvidas', 'donatella_ensaio_operacao'].includes(banco.rows[0]?.nome)) throw Error('DESTINO_DUVIDAS_RECUSADO');
        await cliente.query("SELECT pg_advisory_xact_lock(hashtextextended('atendimento-duvidas:' || $1, 0))", [empresaId]);
        const tx: TransacaoDuvidas = {
          conexao: cliente,
          async codigoDisponivel(codigo) {
            await cliente.query('SAVEPOINT codigo_disponivel');
            await cliente.query("SELECT pg_advisory_xact_lock(hashtextextended('atendimento-duvidas-codigo:' || $1, 0))", [codigo]);
            const r = await cliente.query('SELECT 1 FROM atendimento_apoio.casos WHERE conteudo->>\'codigo\'=$1 LIMIT 1', [codigo]);
            // Liberar o lock de código já ocupado antes da próxima tentativa;
            // somente o código reservado permanece bloqueado até o commit.
            if (r.rowCount !== 0) await cliente.query('ROLLBACK TO SAVEPOINT codigo_disponivel');
            await cliente.query('RELEASE SAVEPOINT codigo_disponivel');
            return r.rowCount === 0;
          },
          async obter<D extends DocumentoDuvidas>(colecao: ColecaoDuvidas, id: string): Promise<D | null> {
            const r = await cliente.query<{ conteudo: D }>(`SELECT conteudo FROM atendimento_apoio.${tabelas[colecao]} WHERE empresa_id=$1 AND id=$2`, [empresaId, id]);
            return r.rows[0]?.conteudo ?? null;
          },
          async buscar<D extends DocumentoDuvidas>(colecao: ColecaoDuvidas, campo: 'codigo' | 'dedupe' | 'fingerprint', valor: string): Promise<D | null> {
            if (!campos.has(campo)) throw Error('DUVIDAS_CAMPO_INVALIDO');
            const r = await cliente.query<{ conteudo: D }>(`SELECT conteudo FROM atendimento_apoio.${tabelas[colecao]} WHERE empresa_id=$1 AND conteudo->>$2=$3 ORDER BY atualizada_em DESC,id DESC LIMIT 1`, [empresaId, campo, valor]);
            return r.rows[0]?.conteudo ?? null;
          },
          async listar<D extends DocumentoDuvidas>(colecao: ColecaoDuvidas) {
            const r = await cliente.query<{ conteudo: D }>(`SELECT conteudo FROM atendimento_apoio.${tabelas[colecao]} WHERE empresa_id=$1 ORDER BY atualizada_em DESC,id DESC LIMIT 1001`, [empresaId]);
            if (r.rows.length > 1000) throw Error('DUVIDAS_PAGINACAO_NECESSARIA');
            return r.rows.map(linha => linha.conteudo);
          },
          async salvar(colecao, documento) {
            const d = documento as DocumentoDuvidas & { empresaId?: string; revisao?: number; estado?: string; codigo?: string; dedupe?: string; fingerprint?: string };
            if (d.empresaId !== empresaId || !/^[a-f0-9-]{36}$/i.test(d.id)) throw Error('DUVIDAS_ESCOPO_RECUSADO');
            const revisao = d.revisao || 1;
            await cliente.query(`INSERT INTO atendimento_apoio.${tabelas[colecao]}(empresa_id,id,revisao,conteudo) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(empresa_id,id) DO UPDATE SET revisao=EXCLUDED.revisao,conteudo=EXCLUDED.conteudo,atualizada_em=now() WHERE atendimento_apoio.${tabelas[colecao]}.revisao < EXCLUDED.revisao`, [empresaId, d.id, revisao, JSON.stringify(d)]).then(r => { if (r.rowCount !== 1) throw Error('DUVIDAS_REVISAO_CONFLITANTE'); });
            await cliente.query('INSERT INTO atendimento_apoio.revisoes(empresa_id,colecao,entidade_id,revisao,conteudo) VALUES($1,$2,$3,$4,$5::jsonb)', [empresaId, colecao, d.id, revisao, JSON.stringify(d)]);
          },
          async auditar(e: AuditoriaDuvidas) {
            if (e.empresaId !== empresaId) throw Error('DUVIDAS_ESCOPO_RECUSADO');
            await cliente.query('INSERT INTO atendimento_apoio.auditoria(empresa_id,id,ator_id,entidade_id,acao,revisao,em,motivo) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [empresaId, e.id, e.atorId, e.entidadeId, e.acao, e.revisao, e.em, e.motivo || null]);
          },
          async epoca(incrementar = false) {
            await cliente.query('INSERT INTO atendimento_apoio.catalogo(empresa_id,epoca) VALUES($1,0) ON CONFLICT DO NOTHING', [empresaId]);
            const r = await cliente.query<{ epoca: string }>(incrementar ? 'UPDATE atendimento_apoio.catalogo SET epoca=epoca+1 WHERE empresa_id=$1 RETURNING epoca' : 'SELECT epoca FROM atendimento_apoio.catalogo WHERE empresa_id=$1', [empresaId]);
            return Number(r.rows[0].epoca);
          },
        };
        const resultado = await executar(tx); await cliente.query('COMMIT'); return resultado;
      } catch (erro) { await cliente.query('ROLLBACK').catch(() => undefined); throw erro; }
      finally { cliente.release(); }
    },
  };
}
