-- Manual/aditiva. Proveniência protege escritas posteriores, sem restaurar o banco.
BEGIN;
DO $$ BEGIN IF current_database() NOT IN ('donatella_operacao','donatella_ensaio_operacao') THEN RAISE EXCEPTION 'DESTINO_OPERACAO_RECUSADO'; END IF; END $$;
CREATE TABLE IF NOT EXISTS atendimento_operacao.importacao_estado(
 entidade text NOT NULL CHECK(entidade IN ('contato','conversa','mensagem','anexo','etapa','negocio','compromisso')),
 origem_id uuid NOT NULL, destino_id uuid NOT NULL, hash_origem text NOT NULL CHECK(hash_origem ~ '^[a-f0-9]{64}$'),
 hash_destino text NOT NULL CHECK(hash_destino ~ '^[a-f0-9]{64}$'), importacao_id text NOT NULL,
 atualizada_em timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(entidade,origem_id), UNIQUE(entidade,destino_id)
);
REVOKE ALL ON atendimento_operacao.importacao_estado FROM PUBLIC;
COMMIT;
