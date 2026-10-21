-- Manual e aditiva. Preserva horário, estado, prioridade e histórico dos alertas humanos.
BEGIN;
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '15s';
DO $$ BEGIN
 IF current_database() NOT IN ('donatella_operacao','donatella_ensaio_operacao') THEN RAISE EXCEPTION 'OPERACAO_LEMBRETE_BANCO_RECUSADO'; END IF;
END $$;
ALTER TABLE atendimento_operacao.lembrete_conversa
 ADD COLUMN descricao varchar(1000) NOT NULL DEFAULT '';
COMMIT;
