/** O histórico acompanha o contato exato. Não agrupa telefones, nomes ou canais. */
export const escopoHistoricoSQL = `WITH conversas AS MATERIALIZED (
 SELECT v.id,v.criada_em FROM atendimento_operacao.conversa v
 JOIN atendimento_operacao.conversa solicitada ON solicitada.id=$1 AND solicitada.contato_id=v.contato_id AND solicitada.ficticia=v.ficticia
 WHERE v.contato_id=$4 AND v.ficticia=$5
), eventos AS MATERIALIZED (
 SELECT a.id,v.id AS conversa_id,a.criada_em,
 CASE WHEN a.acao='encerrar' THEN 'encerramento' ELSE 'reabertura' END AS evento,
 a.autor_id AS evento_autor_id,nullif(a.autor_nome,'') AS evento_autor_nome
 FROM atendimento_operacao.auditoria a JOIN conversas v ON a.entidade_id=v.id::text
 WHERE a.acao IN ('encerrar','reabrir') OR a.acao='iniciar_conversa' AND EXISTS (
  SELECT 1 FROM conversas anterior WHERE (anterior.criada_em,anterior.id)<(v.criada_em,v.id)
 )
 UNION ALL
 -- O início legado é conhecido. Seu autor não deve ser inventado.
 SELECT v.id,v.id,v.criada_em,'inicio',null::text,null::text FROM conversas v
 WHERE EXISTS (SELECT 1 FROM conversas anterior WHERE (anterior.criada_em,anterior.id)<(v.criada_em,v.id))
 AND NOT EXISTS (SELECT 1 FROM atendimento_operacao.auditoria a WHERE a.entidade_id=v.id::text AND (a.acao='iniciar_conversa' OR a.acao='reabrir' AND a.versao=1))
), pagina AS MATERIALIZED (
 SELECT * FROM (
  SELECT m.id,m.conversa_id,m.criada_em,null::text AS evento,null::text AS evento_autor_id,null::text AS evento_autor_nome
  FROM atendimento_operacao.mensagem m JOIN conversas v ON v.id=m.conversa_id
  UNION ALL SELECT * FROM eventos
 ) linhas WHERE ($2::timestamptz IS NULL OR (criada_em,id)<($2::timestamptz,$3::uuid))
 ORDER BY criada_em DESC,id DESC LIMIT 51
)`;

export type EventoHistoricoOperacao = 'encerramento'|'reabertura'|'inicio';
export function eventoHistoricoDTO(v:Record<string,unknown>) {
 const evento=v.evento as EventoHistoricoOperacao;
 return {id:String(v.id),conversaId:String(v.conversa_id),evento,
  autor:'humano' as const,autorId:typeof v.evento_autor_id==='string'?v.evento_autor_id:null,
  autorNome:typeof v.evento_autor_nome==='string'?v.evento_autor_nome:null,
  conteudo:null,tipo:'evento',estado:'registrado',criadaEm:String(v.cursor_em),
  anexoId:null,citadaId:null,citada:null,citadaReferenciaAusente:false,
  falhaCodigo:null,intencaoId:null,podeResponder:false,podeTentarNovamente:false};
}
