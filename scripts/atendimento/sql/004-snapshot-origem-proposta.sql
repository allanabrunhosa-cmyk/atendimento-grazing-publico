-- PROPOSTA: aplicar somente junto da captura autorizada; não inicia cópia.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
CREATE FUNCTION public.donatella_migracao_snapshot(esquema text, tabela text, apos jsonb DEFAULT NULL, limite integer DEFAULT 500)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,donatella_migracao AS $$
DECLARE colunas text[]; ordenacao text; cursor_tipado text; registros jsonb; proxima jsonb; quantidade integer;
BEGIN
  IF NOT donatella_migracao.coletor_autorizado() THEN RAISE EXCEPTION 'Coletor não autorizado' USING ERRCODE='42501'; END IF;
  PERFORM donatella_migracao.validar_continuidade();
  IF limite IS NULL OR limite NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'Limite inválido'; END IF;
  SELECT r.pk INTO STRICT colunas FROM donatella_migracao.tabela r
    WHERE r.schema_name=donatella_migracao_snapshot.esquema AND r.table_name=donatella_migracao_snapshot.tabela;
  IF apos IS NOT NULL THEN
    IF jsonb_typeof(apos) <> 'object' THEN RAISE EXCEPTION 'Cursor inválido'; END IF;
    IF (SELECT count(*) FROM jsonb_object_keys(apos)) <> cardinality(colunas)
       OR EXISTS (SELECT 1 FROM unnest(colunas) c WHERE NOT (apos ? c) OR apos->c = 'null'::jsonb)
       THEN RAISE EXCEPTION 'Cursor inválido'; END IF;
  END IF;
  SELECT string_agg(format('t.%I',c),',' ORDER BY ord),
    string_agg(format('(jsonb_populate_record(NULL::%I.%I,$1)).%I',esquema,tabela,c),',' ORDER BY ord)
    INTO ordenacao,cursor_tipado FROM unnest(colunas) WITH ORDINALITY u(c,ord);
  EXECUTE format('SELECT coalesce(jsonb_agg(jsonb_build_object(''chave'',donatella_migracao.chave(to_jsonb(p),$3),''dados'',donatella_migracao.projetar($4,to_jsonb(p))) ORDER BY %s),''[]''::jsonb)
    FROM (SELECT t.* FROM %I.%I t WHERE $1 IS NULL OR ROW(%s)>ROW(%s) ORDER BY %s LIMIT $2) p',replace(ordenacao,'t.','p.'),esquema,tabela,ordenacao,cursor_tipado,ordenacao)
    INTO registros USING apos,limite,colunas,esquema;
  quantidade := jsonb_array_length(registros);
  IF quantidade > 0 THEN proxima := registros->(quantidade-1)->'chave'; ELSE proxima := apos; END IF;
  RETURN jsonb_build_object('schema',esquema,'tabela',tabela,'registros',registros,'proxima',proxima,'fim',quantidade<limite);
END;
$$;
REVOKE ALL ON FUNCTION public.donatella_migracao_snapshot(text,text,jsonb,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.donatella_migracao_snapshot(text,text,jsonb,integer) TO service_role;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM donatella_migracao.coletor WHERE fingerprint IS NOT NULL) THEN
    GRANT EXECUTE ON FUNCTION public.donatella_migracao_snapshot(text,text,jsonb,integer) TO anon;
  END IF;
END; $$;
COMMIT;
