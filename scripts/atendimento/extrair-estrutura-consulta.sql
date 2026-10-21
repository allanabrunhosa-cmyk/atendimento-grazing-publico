-- Somente catálogo técnico da recuperação isolada: sem defaults, funções ou dados.
BEGIN READ ONLY;
SET LOCAL statement_timeout='10s';
WITH alvos AS (
 SELECT c.oid,n.nspname esquema,c.relname tabela FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind='r' AND (n.nspname='public' OR (n.nspname='auth' AND c.relname='users') OR (n.nspname='storage' AND c.relname IN ('objects','buckets')))
), colunas AS (
 SELECT a.oid,a.esquema,a.tabela,jsonb_agg(jsonb_build_object('nome',at.attname,'tipo',format_type(at.atttypid,at.atttypmod),'obrigatoria',at.attnotnull) ORDER BY at.attnum) colunas
 FROM alvos a JOIN pg_attribute at ON at.attrelid=a.oid AND at.attnum>0 AND NOT at.attisdropped
 WHERE a.esquema<>'auth' OR at.attname IN ('id','email','created_at','updated_at','deleted_at','banned_until') GROUP BY a.oid,a.esquema,a.tabela
)
SELECT jsonb_build_object('tabelas',(SELECT jsonb_agg(jsonb_build_object('esquema',c.esquema,'tabela',c.tabela,'colunas',c.colunas,'pk',
 (SELECT jsonb_agg(at.attname ORDER BY k.ord) FROM pg_constraint p CROSS JOIN LATERAL unnest(p.conkey) WITH ORDINALITY k(num,ord) JOIN pg_attribute at ON at.attrelid=p.conrelid AND at.attnum=k.num WHERE p.conrelid=c.oid AND p.contype='p')) ORDER BY c.esquema,c.tabela) FROM colunas c),
 'enums',(SELECT coalesce(jsonb_agg(e),'[]'::jsonb) FROM (SELECT n.nspname esquema,t.typname nome,jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) valores FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace JOIN pg_enum e ON e.enumtypid=t.oid WHERE n.nspname IN ('public','storage','auth') GROUP BY n.nspname,t.typname) e),
 'relacoes',(SELECT coalesce(jsonb_agg(jsonb_build_object('esquema',a.esquema,'tabela',a.tabela,'nome',p.conname,'definicao',pg_get_constraintdef(p.oid,true))),'[]'::jsonb) FROM alvos a JOIN pg_constraint p ON p.conrelid=a.oid JOIN alvos b ON b.oid=p.confrelid WHERE p.contype='f'));
ROLLBACK;
