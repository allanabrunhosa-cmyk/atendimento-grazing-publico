-- PROPOSTA PARA A ORIGEM: não aplicar sem autorização específica do proprietário.
-- Instalação transacional/aditiva. Nenhuma função de negócio, webhook ou cron é alterado.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
CREATE SCHEMA donatella_migracao;
REVOKE ALL ON SCHEMA donatella_migracao FROM PUBLIC;
-- Opcional: credencial aleatória dedicada ao coletor, guardada fora do Git/Cloud.
-- O instalador privado pode fornecer apenas seu SHA-256 nesta configuração local.
-- Sem hash, permanece exclusivamente service_role. Não rotaciona credenciais existentes.
CREATE TABLE donatella_migracao.coletor(
  id boolean PRIMARY KEY DEFAULT true CHECK(id),
  fingerprint text CHECK(fingerprint IS NULL OR fingerprint ~ '^[a-f0-9]{64}$'),
  interrompida_em timestamptz
);
DO $$
DECLARE fingerprint text := current_setting('donatella.coletor_hash',true);
BEGIN
  IF fingerprint IS NOT NULL AND fingerprint<>'' THEN
    IF fingerprint !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'Fingerprint inválido'; END IF;
  END IF;
  INSERT INTO donatella_migracao.coletor(id,fingerprint) VALUES(true,nullif(fingerprint,''));
END;
$$;

-- Uma parada fica registrada mesmo se alguém recriar os triggers posteriormente.
-- Não existe retomada automática: a lacuna exige reconciliação e decisão explícitas.
CREATE FUNCTION donatella_migracao.validar_continuidade() RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,donatella_migracao AS $$
DECLARE funcao oid := to_regprocedure('donatella_migracao.capturar()');
BEGIN
  IF funcao IS NULL OR (SELECT count(*) FROM donatella_migracao.coletor)<>1
    OR EXISTS(SELECT 1 FROM donatella_migracao.coletor WHERE interrompida_em IS NOT NULL)
    OR (SELECT count(*) FROM donatella_migracao.tabela)<>37
    OR EXISTS(SELECT 1 FROM donatella_migracao.tabela alvo WHERE NOT EXISTS(
      SELECT 1 FROM pg_trigger g JOIN pg_class c ON c.oid=g.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname=alvo.schema_name AND c.relname=alvo.table_name
        AND g.tgname='donatella_migracao_captura' AND g.tgfoid=funcao
        AND g.tgenabled IN ('O','A') AND g.tgtype=29 AND g.tgqual IS NULL
    )) THEN RAISE EXCEPTION 'CAPTURA_CONTINUIDADE_INTERROMPIDA' USING ERRCODE='55000'; END IF;
END;
$$;
CREATE FUNCTION donatella_migracao.coletor_autorizado() RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,donatella_migracao AS $$
DECLARE papel text := (SELECT auth.role()); token text; fingerprint text;
BEGIN
  IF papel='service_role' THEN RETURN true; END IF;
  IF papel IS NULL OR papel NOT IN ('anon','authenticated') THEN RETURN false; END IF;
  token := coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-donatella-coletor','');
  IF token !~ '^[a-f0-9]{64}$' THEN RETURN false; END IF;
  SELECT c.fingerprint INTO fingerprint FROM donatella_migracao.coletor c WHERE c.id;
  RETURN coalesce(encode(sha256(convert_to(token,'UTF8')),'hex')=fingerprint,false);
END;
$$;
CREATE TABLE donatella_migracao.tabela (schema_name text NOT NULL, table_name text NOT NULL, pk text[] NOT NULL, PRIMARY KEY(schema_name,table_name));
INSERT INTO donatella_migracao.tabela
SELECT 'public', nome, CASE WHEN nome = 'contact_cooldowns' THEN ARRAY['contact_phone','rule_id'] ELSE ARRAY['id'] END
FROM unnest(ARRAY['appointments','automation_executions','automation_logs','automation_rules','automation_scheduled','contact_cooldowns','contacts','conversation_activities','conversation_states','conversations','deal_activities','deals','message_grouping_queue','message_processing_queue','messages','nina_processing_queue','nina_settings','notifications','orders','pipeline_stages','product_catalog_audit','profiles','send_queue','support_cases','system_settings','tag_definitions','team_business_hours','team_functions','team_holidays','team_members','teams','user_roles','webhook_events','whatsapp_templates']) nome;
INSERT INTO donatella_migracao.tabela VALUES ('storage','objects',ARRAY['id']),('storage','buckets',ARRAY['id']),('auth','users',ARRAY['id']);
CREATE TABLE donatella_migracao.transacao (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), xid text NOT NULL UNIQUE,
  registrada_em timestamptz NOT NULL DEFAULT clock_timestamp(), confirmada_em timestamptz
);
CREATE TABLE donatella_migracao.evento (
  sequencia bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  transacao_id uuid NOT NULL REFERENCES donatella_migracao.transacao(id),
  schema_name text NOT NULL, table_name text NOT NULL, operacao text NOT NULL CHECK(operacao IN ('INSERT','UPDATE','DELETE')),
  chave_anterior jsonb, chave_posterior jsonb, anterior jsonb, posterior jsonb,
  registrada_em timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX evento_transacao ON donatella_migracao.evento(transacao_id,sequencia);
CREATE INDEX transacao_pendente ON donatella_migracao.transacao(registrada_em,id) WHERE confirmada_em IS NULL;

CREATE FUNCTION donatella_migracao.projetar(schema_name text, dados jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  -- Credenciais de auth nunca são replicadas: mesmas contas do HUB, autoria legada preservada.
  SELECT CASE WHEN schema_name = 'auth' AND dados IS NOT NULL THEN
    jsonb_build_object('id',dados->'id','email',dados->'email','created_at',dados->'created_at','updated_at',dados->'updated_at','deleted_at',dados->'deleted_at','banned_until',dados->'banned_until')
  ELSE dados END;
$$;
CREATE FUNCTION donatella_migracao.chave(dados jsonb, colunas text[]) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE WHEN dados IS NULL THEN NULL ELSE (SELECT jsonb_object_agg(c,dados->c) FROM unnest(colunas) c) END;
$$;
CREATE FUNCTION donatella_migracao.capturar() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,donatella_migracao AS $$
DECLARE antigas jsonb; novas jsonb; colunas text[]; transacao uuid;
BEGIN
  SELECT pk INTO STRICT colunas FROM donatella_migracao.tabela WHERE schema_name=TG_TABLE_SCHEMA AND table_name=TG_TABLE_NAME;
  IF TG_OP <> 'INSERT' THEN antigas := donatella_migracao.projetar(TG_TABLE_SCHEMA,to_jsonb(OLD)); END IF;
  IF TG_OP <> 'DELETE' THEN novas := donatella_migracao.projetar(TG_TABLE_SCHEMA,to_jsonb(NEW)); END IF;
  INSERT INTO donatella_migracao.transacao(xid) VALUES(pg_current_xact_id()::text)
    ON CONFLICT(xid) DO UPDATE SET xid=excluded.xid RETURNING id INTO transacao;
  INSERT INTO donatella_migracao.evento(transacao_id,schema_name,table_name,operacao,chave_anterior,chave_posterior,anterior,posterior)
    VALUES(transacao,TG_TABLE_SCHEMA,TG_TABLE_NAME,TG_OP,donatella_migracao.chave(antigas,colunas),donatella_migracao.chave(novas,colunas),antigas,novas);
  RETURN NULL;
END;
$$;

DO $$
DECLARE alvo record; pk_real text[];
BEGIN
  -- Qualquer divergência cancela tudo antes da instalação; não ajusta tabelas de negócio.
  FOR alvo IN SELECT * FROM donatella_migracao.tabela ORDER BY schema_name,table_name LOOP
    SELECT array_agg(a.attname::text ORDER BY k.ord) INTO pk_real
    FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid JOIN pg_namespace n ON n.oid=t.relnamespace
    CROSS JOIN LATERAL unnest(c.conkey) WITH ORDINALITY k(attnum,ord)
    JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum=k.attnum
    WHERE c.contype='p' AND n.nspname=alvo.schema_name AND t.relname=alvo.table_name;
    IF pk_real IS DISTINCT FROM alvo.pk THEN RAISE EXCEPTION 'PK divergente em %.%',alvo.schema_name,alvo.table_name; END IF;
  END LOOP;
  FOR alvo IN SELECT * FROM donatella_migracao.tabela ORDER BY schema_name,table_name LOOP
    EXECUTE format('CREATE TRIGGER donatella_migracao_captura AFTER INSERT OR UPDATE OR DELETE ON %I.%I FOR EACH ROW EXECUTE FUNCTION donatella_migracao.capturar()',alvo.schema_name,alvo.table_name);
  END LOOP;
END;
$$;

-- RPC mínimo para coletor privado; o schema do outbox não é exposto via PostgREST.
CREATE FUNCTION public.donatella_migracao_ler_lote(limite integer DEFAULT 50) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,donatella_migracao AS $$
DECLARE resultado jsonb;
BEGIN
  IF NOT donatella_migracao.coletor_autorizado() THEN RAISE EXCEPTION 'Coletor não autorizado' USING ERRCODE='42501'; END IF;
  PERFORM donatella_migracao.validar_continuidade();
  IF limite IS NULL OR limite NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Limite inválido'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'xid',t.xid,'eventos',(
    SELECT jsonb_agg(jsonb_build_object('sequencia',e.sequencia::text,'schema',e.schema_name,'tabela',e.table_name,'operacao',e.operacao,'chave_anterior',e.chave_anterior,'chave_posterior',e.chave_posterior,'anterior',e.anterior,'posterior',e.posterior) ORDER BY e.sequencia)
    FROM donatella_migracao.evento e WHERE e.transacao_id=t.id))), '[]'::jsonb) INTO resultado
  FROM (SELECT * FROM donatella_migracao.transacao WHERE confirmada_em IS NULL ORDER BY registrada_em,id LIMIT limite) t;
  RETURN resultado;
END;
$$;
CREATE FUNCTION public.donatella_migracao_confirmar(ids uuid[]) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,donatella_migracao AS $$
DECLARE quantidade integer;
BEGIN
  IF NOT donatella_migracao.coletor_autorizado() THEN RAISE EXCEPTION 'Coletor não autorizado' USING ERRCODE='42501'; END IF;
  PERFORM donatella_migracao.validar_continuidade();
  IF coalesce(cardinality(ids),0) NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Quantidade inválida'; END IF;
  UPDATE donatella_migracao.transacao SET confirmada_em=clock_timestamp() WHERE id=ANY(ids) AND confirmada_em IS NULL;
  GET DIAGNOSTICS quantidade=ROW_COUNT; RETURN quantidade;
END;
$$;
REVOKE ALL ON ALL TABLES IN SCHEMA donatella_migracao FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA donatella_migracao FROM PUBLIC;
REVOKE ALL ON FUNCTION public.donatella_migracao_ler_lote(integer),public.donatella_migracao_confirmar(uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.donatella_migracao_ler_lote(integer),public.donatella_migracao_confirmar(uuid[]) TO service_role;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM donatella_migracao.coletor WHERE fingerprint IS NOT NULL) THEN
    GRANT EXECUTE ON FUNCTION public.donatella_migracao_ler_lote(integer),public.donatella_migracao_confirmar(uuid[]) TO anon;
  END IF;
END; $$;
COMMIT;
-- Consulta sem watermark: transações que confirmam tardiamente continuam pendentes.
-- Nenhuma limpeza automática. Confirmar só depois de commit no destino + arquivo privado durável.
