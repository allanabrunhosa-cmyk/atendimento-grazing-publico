-- Consulta NOVA. Somente leitura: não instala captura nem executa funções de negócio.
-- Retorna nomes técnicos e hashes; nunca retorna corpos, defaults ou linhas de clientes.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';
SET LOCAL search_path = pg_catalog, public, extensions;
WITH alvos AS (
  SELECT c.oid, n.nspname, c.relname, c.relkind, c.relowner, c.relrowsecurity,
    c.relforcerowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE (n.nspname='public' AND c.relkind IN ('r','v'))
    OR (n.nspname='auth' AND c.relname='users' AND c.relkind='r')
    OR (n.nspname='storage' AND c.relname IN ('objects','buckets') AND c.relkind='r')
), itens AS (
  SELECT 'relacao'::text AS tipo, format('%I.%I',a.nspname,a.relname) AS nome,
    md5(jsonb_build_object('tipo',a.relkind,'owner',pg_get_userbyid(a.relowner),
      'rls',a.relrowsecurity,'force_rls',a.relforcerowsecurity,
      'colunas',(SELECT jsonb_agg(jsonb_build_array(at.attnum,at.attname,
        format_type(at.atttypid,at.atttypmod),at.attnotnull,at.attidentity,at.attgenerated,
        CASE WHEN at.attcollation<>0 THEN at.attcollation::regcollation::text END,
        pg_get_expr(d.adbin,d.adrelid)) ORDER BY at.attnum)
        FROM pg_attribute at LEFT JOIN pg_attrdef d ON d.adrelid=at.attrelid AND d.adnum=at.attnum
        WHERE at.attrelid=a.oid AND at.attnum>0 AND NOT at.attisdropped),
      'view',CASE WHEN a.relkind='v' THEN pg_get_viewdef(a.oid,false) END)::text) AS hash
  FROM alvos a
  UNION ALL
  SELECT 'constraint',format('%I.%I/%I',a.nspname,a.relname,c.conname),
    md5(jsonb_build_array(pg_get_constraintdef(c.oid,false),c.convalidated,c.condeferrable,c.condeferred)::text)
  FROM pg_constraint c JOIN alvos a ON a.oid=c.conrelid
  UNION ALL
  SELECT 'indice',format('%I.%I/%I',a.nspname,a.relname,c.relname),
    md5(jsonb_build_array(pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready,i.indisunique,i.indisprimary)::text)
  FROM pg_index i JOIN alvos a ON a.oid=i.indrelid JOIN pg_class c ON c.oid=i.indexrelid
  UNION ALL
  SELECT 'trigger',format('%I.%I/%I',a.nspname,a.relname,t.tgname),
    md5(jsonb_build_array(pg_get_triggerdef(t.oid,false),t.tgenabled)::text)
  FROM pg_trigger t JOIN alvos a ON a.oid=t.tgrelid WHERE NOT t.tgisinternal
  UNION ALL
  SELECT 'policy',format('%I.%I/%I',a.nspname,a.relname,p.polname),
    md5(jsonb_build_array(p.polcmd,p.polpermissive,
      (SELECT jsonb_agg(nome ORDER BY nome) FROM
       (SELECT CASE WHEN r=0 THEN 'PUBLIC' ELSE pg_get_userbyid(r) END AS nome FROM unnest(p.polroles) r) papeis),
      pg_get_expr(p.polqual,p.polrelid),pg_get_expr(p.polwithcheck,p.polrelid))::text)
  FROM pg_policy p JOIN alvos a ON a.oid=p.polrelid
  UNION ALL
  SELECT 'funcao',format('%I.%I(%s)',n.nspname,p.proname,pg_get_function_identity_arguments(p.oid)),
    md5(jsonb_build_array(pg_get_functiondef(p.oid),pg_get_userbyid(p.proowner))::text)
  FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE p.prokind IN ('f','p') AND
    (n.nspname='public' OR p.oid IN (SELECT t.tgfoid FROM pg_trigger t JOIN alvos a ON a.oid=t.tgrelid WHERE NOT t.tgisinternal))
    AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')
)
SELECT jsonb_build_object('versao',1,'hash_algoritmo','md5-drift-nao-autenticacao',
  'tabelas_captura',(SELECT count(*) FROM alvos WHERE relkind='r'),
  'itens',(SELECT jsonb_agg(jsonb_build_object('tipo',tipo,'nome',nome,'hash',hash) ORDER BY tipo,nome) FROM itens)) AS definicoes;
ROLLBACK;
