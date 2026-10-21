-- Revalidação somente de leitura, antes/depois da captura autorizada.
-- Abrir consulta NOVA no Lovable Cloud. Não executar a proposta antiga do editor.
-- Resultado contém agregados e metadados técnicos, sem registros/chaves de negócio.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';
WITH alvos AS (
  SELECT c.oid, n.nspname AS schema, c.relname AS tabela,
    pg_get_userbyid(c.relowner) AS proprietario
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE (n.nspname='public' AND c.relkind='r')
    OR (n.nspname='auth' AND c.relname='users' AND c.relkind='r')
    OR (n.nspname='storage' AND c.relname IN ('objects','buckets') AND c.relkind='r')
), metadados AS (
  SELECT a.*, md5((SELECT string_agg(
      concat_ws(':',attnum,attname,format_type(atttypid,atttypmod),attnotnull,attidentity,attgenerated),
      '|' ORDER BY attnum)
    FROM pg_attribute WHERE attrelid=a.oid AND attnum>0 AND NOT attisdropped)) AS colunas_hash,
    (SELECT jsonb_agg(at.attname ORDER BY k.ord)
      FROM pg_index i CROSS JOIN LATERAL unnest(i.indkey) WITH ORDINALITY k(num,ord)
      JOIN pg_attribute at ON at.attrelid=i.indrelid AND at.attnum=k.num
      WHERE i.indrelid=a.oid AND i.indisprimary) AS pk,
    has_table_privilege(current_user,a.oid,'SELECT') AS pode_ler,
    has_table_privilege(current_user,a.oid,'TRIGGER') AS pode_criar_trigger
  FROM alvos a
)
SELECT jsonb_build_object(
  'instante',clock_timestamp(),
  'postgres',current_setting('server_version'),
  'papel',current_user,
  'papel_superusuario',(SELECT rolsuper FROM pg_roles WHERE rolname=current_user),
  'banco_bytes',pg_database_size(current_database()),
  'max_connections',current_setting('max_connections')::int,
  'conexoes_banco',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database()),
  'conexoes_ativas',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND state='active'),
  'conexoes_estado_oculto',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND state IS NULL),
  'estatistica_banco',(SELECT jsonb_build_object('commits',xact_commit,'rollbacks',xact_rollback,
    'deadlocks',deadlocks,'temp_bytes',temp_bytes,'cache_hits',blks_hit,'disk_reads',blks_read,
    'stats_reset',stats_reset) FROM pg_stat_database WHERE datname=current_database()),
  'capture_schema_exists',EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='donatella_migracao'),
  'alvos',(SELECT jsonb_agg(jsonb_build_object('schema',schema,'tabela',tabela,
    'proprietario',proprietario,'colunas_hash',colunas_hash,'pk',pk,
    'pode_ler',pode_ler,'pode_criar_trigger',pode_criar_trigger) ORDER BY schema,tabela) FROM metadados),
  'estatistica_tabelas',(SELECT jsonb_agg(jsonb_build_object('schema',s.schemaname,
    'tabela',s.relname,'insercoes',s.n_tup_ins,'atualizacoes',s.n_tup_upd,'exclusoes',s.n_tup_del,
    'live_estimado',s.n_live_tup,'dead_estimado',s.n_dead_tup))
    FROM pg_stat_user_tables s JOIN alvos a ON a.oid=s.relid)
) AS revalidacao;
ROLLBACK;
