import 'server-only';
import {carregarMidiaMeta} from './operacao-midia-meta';
import type {RepositorioOperacaoPg} from './operacao-repositorio-pg';

/** A preservação de mídia não depende de inferência, fila de IA ou envio.
 * O evento original permanece no banco de entrada. Falha conserva a referência
 * e registra nova tentativa no PostgreSQL, inclusive após reiniciar o processo.
 */
export async function processarMidiaPendenteChat(repo:RepositorioOperacaoPg,config:{token:string;numeroId:string;versao:string},fetcher:typeof fetch=fetch){
 if(repo.modo()!=='operacao')return {estado:'desarmado'};
 const r=await repo.pool.query("SELECT id FROM atendimento_operacao.mensagem WHERE autor='cliente' AND anexo_id IS NULL AND metadados->>'mediaId' ~ '^[0-9]{5,100}$' AND coalesce(metadados->>'midiaProximaTentativa','')<=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') ORDER BY criada_em,id LIMIT 1");
 const id=r.rows[0]?.id;if(!id)return {estado:'vazio'};
 try{
  const midia=await carregarMidiaMeta(repo,id,config,fetcher);
  if(!midia)throw Error('META_MIDIA_INDISPONIVEL');
  await repo.pool.query("UPDATE atendimento_operacao.mensagem SET metadados=metadados-'midiaProximaTentativa'-'midiaFalha' WHERE id=$1",[id]);
  return {estado:'preservada'};
 }catch{
  await repo.pool.query("UPDATE atendimento_operacao.mensagem SET metadados=metadados||jsonb_build_object('midiaFalha','PRESERVACAO_PENDENTE','midiaProximaTentativa',to_char((now()+interval '5 minutes') AT TIME ZONE 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')) WHERE id=$1 AND anexo_id IS NULL",[id]);
  return {estado:'pendente'};
 }
}
