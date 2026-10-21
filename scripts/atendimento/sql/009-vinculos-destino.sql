-- Somente preparação privada. Não aplicar na origem, no HUB ou no banco de recuperação.
BEGIN;
SET LOCAL lock_timeout='1s';
SET LOCAL statement_timeout='10s';
DO $$ BEGIN IF current_database()<>'donatella_preparacao' THEN RAISE EXCEPTION 'Exige preparação privada'; END IF; END $$;
CREATE SCHEMA atendimento_identidades;
CREATE TABLE atendimento_identidades.vinculos (
  hub_usuario_id text PRIMARY KEY CHECK(hub_usuario_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  origem_usuario_id uuid UNIQUE NOT NULL,
  revisado_em timestamptz,
  revisado_por text,
  revogado_em timestamptz,
  CHECK ((revisado_em IS NULL AND revisado_por IS NULL) OR (revisado_em IS NOT NULL AND length(revisado_por) BETWEEN 1 AND 100))
);
CREATE TABLE atendimento_identidades.auditoria (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  instante timestamptz NOT NULL DEFAULT clock_timestamp(),
  operacao text NOT NULL,
  papel text NOT NULL,
  anterior jsonb,
  posterior jsonb
);
CREATE FUNCTION atendimento_identidades.auditar() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog AS $$ BEGIN
  INSERT INTO atendimento_identidades.auditoria(operacao,papel,anterior,posterior)
  VALUES(TG_OP,current_user,CASE WHEN TG_OP<>'INSERT' THEN to_jsonb(OLD) END,CASE WHEN TG_OP<>'DELETE' THEN to_jsonb(NEW) END);
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION atendimento_identidades.auditar() FROM PUBLIC;
CREATE TRIGGER auditar_vinculo AFTER INSERT OR UPDATE OR DELETE ON atendimento_identidades.vinculos
  FOR EACH ROW EXECUTE FUNCTION atendimento_identidades.auditar();
CREATE ROLE donatella_gateway_identidade NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
REVOKE ALL ON SCHEMA atendimento_identidades FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA atendimento_identidades FROM PUBLIC;
GRANT USAGE ON SCHEMA atendimento_identidades TO donatella_gateway_identidade;
GRANT SELECT(hub_usuario_id,origem_usuario_id,revisado_em,revogado_em) ON atendimento_identidades.vinculos TO donatella_gateway_identidade;
-- Sem senha/login ou vínculos automáticos. Revisão/autorização de contas ocorre em etapa própria.
COMMIT;
