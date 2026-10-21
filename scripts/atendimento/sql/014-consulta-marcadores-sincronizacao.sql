-- Metadados técnicos para distinguir recepção de dados, materialização e consulta da origem.
BEGIN;
DO $$ BEGIN IF current_database()<>'donatella_preparacao' THEN RAISE EXCEPTION 'Destino recusado'; END IF; END $$;
GRANT SELECT(recebido_em) ON atendimento_migracao.carga_documento TO donatella_consulta;
GRANT SELECT(aplicado_em) ON atendimento_migracao.materializacao TO donatella_consulta;
COMMIT;
