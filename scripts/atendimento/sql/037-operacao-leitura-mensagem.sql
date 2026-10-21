-- Manual/aditiva. Apenas no destino dedicado. Sem recibos externos à Meta.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DO $$ BEGIN
 IF current_database() NOT IN ('donatella_operacao','donatella_ensaio_operacao') THEN
  RAISE EXCEPTION 'OPERACAO_LEITURA_BANCO_RECUSADO';
 END IF;
END $$;
CREATE TABLE atendimento_operacao.leitura_mensagem (
 mensagem_id uuid NOT NULL REFERENCES atendimento_operacao.mensagem(id),
 autor_id varchar(128) NOT NULL CHECK(length(autor_id)>0),
 lida_em timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(mensagem_id,autor_id)
);
GRANT SELECT,INSERT ON atendimento_operacao.leitura_mensagem TO donatella_operacao_app;
GRANT SELECT ON atendimento_operacao.leitura_mensagem TO donatella_operacao_backup;
COMMIT;
