-- Banco dedicado de entrada: a carga final nunca restaura/importa esta área.
BEGIN;
DO $$ BEGIN IF current_database() NOT IN ('donatella_entrada','donatella_ensaio_entrada') THEN RAISE EXCEPTION 'DESTINO_ENTRADA_RECUSADO'; END IF; END $$;
CREATE SCHEMA IF NOT EXISTS atendimento_entrada;
REVOKE ALL ON SCHEMA atendimento_entrada FROM PUBLIC;
CREATE TABLE IF NOT EXISTS atendimento_entrada.recibo(id uuid PRIMARY KEY,hash text NOT NULL UNIQUE CHECK(hash ~ '^[a-f0-9]{64}$'),corpo bytea NOT NULL CHECK(octet_length(corpo)<=2097152),recebido_em timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS atendimento_entrada.evento(id uuid PRIMARY KEY,recibo_id uuid NOT NULL REFERENCES atendimento_entrada.recibo(id),chave text NOT NULL UNIQUE,tipo text NOT NULL CHECK(tipo IN ('mensagem','status','alteracao')),waba text NOT NULL,numero text,conteudo jsonb NOT NULL,estado text NOT NULL DEFAULT 'pendente' CHECK(estado IN ('pendente','processando','concluido','falho')),tentativas integer NOT NULL DEFAULT 0,proxima_tentativa timestamptz NOT NULL DEFAULT now(),lease uuid,lease_ate timestamptz,codigo text,recebido_em timestamptz NOT NULL DEFAULT now(),concluido_em timestamptz,CHECK((estado='processando')=(lease IS NOT NULL AND lease_ate IS NOT NULL)));
CREATE INDEX IF NOT EXISTS entrada_pendente ON atendimento_entrada.evento(proxima_tentativa,recebido_em,id) WHERE estado IN ('pendente','processando');
REVOKE ALL ON ALL TABLES IN SCHEMA atendimento_entrada FROM PUBLIC;
COMMIT;
