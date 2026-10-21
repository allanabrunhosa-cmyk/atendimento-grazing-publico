import 'server-only';
import { Pool } from 'pg';

type Linha = {hub_usuario_id: string; origem_usuario_id: string; revisado_em: Date | string | null; revogado_em: Date | string | null};
type Consultar = (hubUserId: string) => Promise<Linha[]>;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
/** Consulta a cada requisição; revogação/vínculo não ficam em cache nem são inferidos por email. */
export function criarResolverVinculo(consultar: Consultar) {
  return async (hubUserId: string) => {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(hubUserId)) return null;
    const linhas = await consultar(hubUserId);
    if (linhas.length !== 1) return null;
    const linha = linhas[0];
    if (linha.hub_usuario_id !== hubUserId || !uuid.test(linha.origem_usuario_id) || !linha.revisado_em ||
        !Number.isFinite(new Date(linha.revisado_em).getTime()) || linha.revogado_em !== null) return null;
    return {hubUserId, origemUsuarioId: linha.origem_usuario_id, revisado: true};
  };
}
let pool: Pool | undefined;
async function consultarVinculo(hubUserId: string) {
  const configuracao = process.env.ATENDIMENTO_IDENTIDADES_DATABASE_URL;
  if (!configuracao) throw new Error('VINCULOS_NAO_CONFIGURADOS');
  const url = new URL(configuracao);
  if (url.protocol !== 'postgresql:' || url.hostname !== 'grazing-donatella-homologacao-v2-banco' ||
      url.port !== '5432' || url.pathname !== '/donatella_preparacao' || url.username !== 'donatella_gateway_identidade' ||
      !url.password || url.search || url.hash) throw new Error('DESTINO_VINCULOS_RECUSADO');
  pool ??= new Pool({connectionString: configuracao, max: 2, connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10000, statement_timeout: 3000, application_name: 'donatella-vinculo-homologacao'});
  const resultado = await pool.query<Linha>(`SELECT hub_usuario_id,origem_usuario_id,revisado_em,revogado_em
    FROM atendimento_identidades.vinculos WHERE hub_usuario_id=$1`,[hubUserId]);
  return resultado.rows;
}
export const resolverVinculoAtendimento = criarResolverVinculo(consultarVinculo);
