BEGIN;
DO $$ BEGIN IF current_database() NOT IN ('donatella_operacao','donatella_ensaio_operacao') THEN RAISE EXCEPTION 'DESTINO_ACESSO_RECUSADO'; END IF; END $$;
CREATE SCHEMA IF NOT EXISTS atendimento_acesso;
REVOKE ALL ON SCHEMA atendimento_acesso FROM PUBLIC;
CREATE TABLE IF NOT EXISTS atendimento_acesso.vinculo(hub_usuario_id text PRIMARY KEY, origem_usuario_id uuid, revisado_em timestamptz NOT NULL, ativo boolean NOT NULL DEFAULT true);
CREATE TABLE IF NOT EXISTS atendimento_acesso.sessao(token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),hub_usuario_id text NOT NULL REFERENCES atendimento_acesso.vinculo(hub_usuario_id),versao integer NOT NULL,criada_em timestamptz NOT NULL DEFAULT now(),expira_em timestamptz NOT NULL,revogada_em timestamptz);
CREATE TABLE IF NOT EXISTS atendimento_acesso.tentativa(chave text PRIMARY KEY,falhas integer NOT NULL DEFAULT 0 CHECK(falhas>=0),ate timestamptz NOT NULL);
REVOKE ALL ON ALL TABLES IN SCHEMA atendimento_acesso FROM PUBLIC;
COMMIT;
