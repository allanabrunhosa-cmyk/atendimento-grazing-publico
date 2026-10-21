-- Somente leitura. Usar imediatamente antes/depois da instalação e durante a coleta.
-- Não executa funções de negócio/captura nem retorna linhas, SQL de sessões ou chaves.
-- Contadores são cumulativos; estimativas não comprovam backlog/continuidade completos.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';
SET LOCAL search_path = pg_catalog;
WITH atividade AS (
  SELECT count(*) AS conexoes,
    count(*) FILTER (WHERE state='active') AS ativas,
    count(*) FILTER (WHERE state IS NULL) AS estado_oculto,
    count(*) FILTER (WHERE wait_event_type='Lock') AS aguardando_lock,
    max(extract(epoch FROM clock_timestamp()-xact_start)) AS transacao_mais_antiga_segundos
  FROM pg_stat_activity WHERE datname=current_database()
), captura AS (
  SELECT count(*) AS triggers_encontrados,
    count(*) FILTER (WHERE g.tgenabled IN ('O','A') AND g.tgtype=29
      AND g.tgqual IS NULL AND g.tgfoid=to_regprocedure('donatella_migracao.capturar()')) AS triggers_ativos_corretos
  FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid
  JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE NOT g.tgisinternal AND g.tgname='donatella_migracao_captura'
    AND ((n.nspname='public' AND c.relkind='r')
      OR (n.nspname='auth' AND c.relname='users')
      OR (n.nspname='storage' AND c.relname IN ('objects','buckets')))
)
SELECT jsonb_build_object(
  'versao',1,'instante',clock_timestamp(),'postgres',current_setting('server_version'),
  'papel',current_user,'banco_bytes',pg_database_size(current_database()),
  'max_connections',current_setting('max_connections')::int,
  'atividade',(SELECT to_jsonb(a) FROM atividade a),
  'estatistica_banco',(SELECT jsonb_build_object('commits',xact_commit,'rollbacks',xact_rollback,
    'deadlocks',deadlocks,'temp_bytes',temp_bytes,'cache_hits',blks_hit,'disk_reads',blks_read,
    'stats_reset',stats_reset) FROM pg_stat_database WHERE datname=current_database()),
  'capture_schema_exists',EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='donatella_migracao'),
  'captura',(SELECT to_jsonb(c) FROM captura c),
  'armazenamento_captura',(SELECT jsonb_agg(jsonb_build_object('tabela',s.relname,
    'bytes',pg_total_relation_size(s.relid),'linhas_estimadas',s.n_live_tup,
    'mortas_estimadas',s.n_dead_tup,'ultima_analise',s.last_analyze,
    'ultima_autoanalise',s.last_autoanalyze) ORDER BY s.relname)
    FROM pg_stat_user_tables s WHERE s.schemaname='donatella_migracao')
) AS impacto;
ROLLBACK;
