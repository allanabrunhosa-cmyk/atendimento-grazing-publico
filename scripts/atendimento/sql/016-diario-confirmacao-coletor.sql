-- Diário durável de intenção/resultado: não apaga eventos nem usa watermark global.
BEGIN;
DO $$ BEGIN IF current_database()<>'donatella_preparacao' THEN RAISE EXCEPTION 'Destino recusado'; END IF; END $$;
CREATE TABLE atendimento_migracao.confirmacao (
 execucao uuid NOT NULL,documento_id uuid NOT NULL,
 pronta_em timestamptz NOT NULL DEFAULT now(),observada_em timestamptz,
 PRIMARY KEY(execucao,documento_id),
 FOREIGN KEY(execucao,documento_id) REFERENCES atendimento_migracao.carga_documento(execucao,id)
);
REVOKE ALL ON atendimento_migracao.confirmacao FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON atendimento_migracao.confirmacao TO donatella_coletor;
COMMIT;
