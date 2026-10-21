-- Diagnóstico novo, somente leitura: fila, idade, índices e saúde agregada.
-- Não executa RPC, captura, jobs ou ACK; não retorna payloads, IDs, SQL de sessões ou chaves.
-- Repetir a mesma consulta em dois instantes permite calcular taxas sem fabricar alterações.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';
SET LOCAL search_path = pg_catalog;
WITH fila AS (
 SELECT count(*) FILTER (WHERE confirmada_em IS NULL) AS pendentes,
   count(*) FILTER (WHERE confirmada_em IS NOT NULL) AS confirmadas,
   count(*) AS transacoes_registradas,
   min(registrada_em) FILTER (WHERE confirmada_em IS NULL) AS pendencia_mais_antiga,
   max(registrada_em) AS ultima_transacao_registrada,
   max(confirmada_em) AS ultima_confirmacao
 FROM donatella_migracao.transacao
), primeira AS (
 SELECT id FROM donatella_migracao.transacao WHERE confirmada_em IS NULL
 ORDER BY registrada_em,id LIMIT 1
), tamanho_primeira AS (
 SELECT count(*) AS eventos,
   coalesce(sum(pg_column_size(e)),0) AS bytes_fisicos_estimados
 FROM donatella_migracao.evento e JOIN primeira p ON p.id=e.transacao_id
), atividade AS (
 SELECT count(*) AS conexoes,
   count(*) FILTER (WHERE state='active') AS ativas,
   count(*) FILTER (WHERE state IS NULL) AS estados_ocultos,
   count(*) FILTER (WHERE wait_event_type='Lock') AS aguardando_lock,
   count(*) FILTER (WHERE state='idle in transaction') AS transacoes_ociosas,
   max(extract(epoch FROM clock_timestamp()-xact_start)) AS transacao_mais_antiga_segundos,
   max(extract(epoch FROM clock_timestamp()-query_start)) FILTER (WHERE state='active') AS consulta_ativa_mais_antiga_segundos
 FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
), captura AS (
 SELECT count(*) AS tabelas_previstas,
   count(*) FILTER (WHERE EXISTS (
     SELECT 1 FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid
     JOIN pg_namespace n ON n.oid=c.relnamespace
     WHERE n.nspname=a.schema_name AND c.relname=a.table_name
       AND g.tgname='donatella_migracao_captura' AND NOT g.tgisinternal
       AND g.tgenabled IN ('O','A') AND g.tgtype=29 AND g.tgqual IS NULL
       AND g.tgfoid=to_regprocedure('donatella_migracao.capturar()')
   )) AS triggers_ativos_corretos
 FROM donatella_migracao.tabela a
)
SELECT jsonb_build_object(
 'versao',1,'instante',clock_timestamp(),
 'fila',(SELECT to_jsonb(f)||jsonb_build_object('idade_pendencia_mais_antiga_segundos',
   extract(epoch FROM clock_timestamp()-f.pendencia_mais_antiga),'contagem_exata',true) FROM fila f),
 'primeira_transacao',(SELECT to_jsonb(t) FROM tamanho_primeira t),
 'atividade',(SELECT to_jsonb(a) FROM atividade a),
 'captura',(SELECT to_jsonb(c)||jsonb_build_object('parada_registrada',
   EXISTS(SELECT 1 FROM donatella_migracao.coletor WHERE interrompida_em IS NOT NULL)) FROM captura c),
 'banco_bytes',pg_database_size(current_database()),
 'funcoes',(SELECT jsonb_agg(jsonb_build_object('nome',p.proname,
   'assinatura',pg_get_function_identity_arguments(p.oid),'definicao_hash',md5(pg_get_functiondef(p.oid))) ORDER BY p.proname)
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE (n.nspname='public' AND p.proname IN ('donatella_migracao_ler_lote','donatella_migracao_snapshot','donatella_migracao_confirmar'))
      OR (n.nspname='donatella_migracao' AND p.proname IN ('capturar','validar_continuidade','coletor_autorizado'))),
 'indices',(SELECT jsonb_agg(jsonb_build_object('tabela',t.relname,'indice',i.relname,
   'valido',x.indisvalid,'pronto',x.indisready,'primario',x.indisprimary,
   'definicao_hash',md5(pg_get_indexdef(i.oid)),'bytes',pg_relation_size(i.oid)) ORDER BY t.relname,i.relname)
   FROM pg_index x JOIN pg_class i ON i.oid=x.indexrelid JOIN pg_class t ON t.oid=x.indrelid
   JOIN pg_namespace n ON n.oid=t.relnamespace
   WHERE n.nspname='donatella_migracao' AND t.relname IN ('transacao','evento')),
 'armazenamento_captura',(SELECT jsonb_agg(jsonb_build_object('tabela',s.relname,
   'bytes',pg_total_relation_size(s.relid),'linhas_estimadas',s.n_live_tup,
   'mortas_estimadas',s.n_dead_tup,'ultima_analise',s.last_analyze,'ultima_autoanalise',s.last_autoanalyze) ORDER BY s.relname)
   FROM pg_stat_user_tables s WHERE s.schemaname='donatella_migracao')
) AS diagnostico_coleta;
ROLLBACK;
