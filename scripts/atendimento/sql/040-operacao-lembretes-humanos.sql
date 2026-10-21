-- Manual e aditiva. Somente lembretes humanos. Não cria timer ou intenção de envio.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DO $$ BEGIN
 IF current_database() NOT IN ('donatella_operacao','donatella_ensaio_operacao') THEN RAISE EXCEPTION 'OPERACAO_LEMBRETE_BANCO_RECUSADO'; END IF;
END $$;
CREATE TABLE atendimento_operacao.lembrete_conversa (
 id uuid PRIMARY KEY,
 conversa_id uuid NOT NULL REFERENCES atendimento_operacao.conversa(id),
 agendado_para timestamptz NOT NULL,
 estado text NOT NULL DEFAULT 'pendente' CHECK(estado IN ('pendente','concluido','cancelado')),
 versao bigint NOT NULL DEFAULT 1 CHECK(versao BETWEEN 1 AND 9007199254740991),
 criado_por_id varchar(128) NOT NULL CHECK(length(criado_por_id)>0),
 criado_por_nome varchar(200) NOT NULL,
 atualizado_por_id varchar(128) NOT NULL CHECK(length(atualizado_por_id)>0),
 atualizado_por_nome varchar(200) NOT NULL,
 criada_em timestamptz NOT NULL DEFAULT now(),
 atualizada_em timestamptz NOT NULL DEFAULT now(),
 finalizada_em timestamptz,
 CHECK((estado='pendente')=(finalizada_em IS NULL))
);
CREATE UNIQUE INDEX operacao_lembrete_pendente_unico ON atendimento_operacao.lembrete_conversa(conversa_id) WHERE estado='pendente';
CREATE INDEX operacao_lembrete_historico ON atendimento_operacao.lembrete_conversa(conversa_id,criada_em DESC,id DESC);
REVOKE ALL ON atendimento_operacao.lembrete_conversa FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON atendimento_operacao.lembrete_conversa TO donatella_operacao_app;
GRANT SELECT ON atendimento_operacao.lembrete_conversa TO donatella_operacao_backup;
COMMIT;
